// D1 の読み書きと、段階配信の歩み（tick）。判定は matching.ts の decide に任せ、ここは適用だけを行う。
// 同時に複数の画面が tick しても二重に配らないよう、offers.last_check_at で楽観ロックを取る。
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { CONFIG, capFor, decide, rankCandidates, type Prefs, type Wave } from "./matching";
import { generateMessage, structurePrefs } from "./llm";

export const db = (): D1Database => getCloudflareContext().env.DB;

const json = <T>(s: string): T => JSON.parse(s) as T;

export const sha256Hex = async (text: string) => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

type StoreRow = { id: string; name: string; genre: string; avg_price: number; allergens: string; lat: number; lng: number; presets: string };
type OfferRow = {
  id: string; store_id: string; seats: number; perk: string; message: string; message_source: string; llm_cost_usd: number | null;
  created_at: number; expires_at: number; status: string; cap: number; candidate_ids: string; waves: string; last_check_at: number; stop_reason: string | null;
};

export type Store = { id: string; name: string; genre: string; avgPrice: number; allergens: string[]; lat: number; lng: number; presets: { label: string }[] };

const toStore = (r: StoreRow): Store => ({
  id: r.id, name: r.name, genre: r.genre, avgPrice: r.avg_price, allergens: json(r.allergens), lat: r.lat, lng: r.lng, presets: json(r.presets),
});

export const storeByKey = async (key: string | null): Promise<Store | null> => {
  if (!key) return null;
  const row = await db().prepare("SELECT * FROM stores WHERE key_hash = ?").bind(await sha256Hex(key)).first<StoreRow>();
  return row ? toStore(row) : null;
};

// ---- オファー ----

export const createOffer = async (store: Store, seats: number, presetIndex: number) => {
  const perk = store.presets[presetIndex]?.label;
  if (!perk) throw new Error("特典のプリセットが見つかりません");
  const now = Date.now();
  const active = await db().prepare("SELECT id FROM offers WHERE store_id = ? AND status = 'active'").bind(store.id).first();
  if (active) throw new Error("進行中のオファーがあります。先に止めてください");
  const rows = await db().prepare("SELECT id, lat, lng, genres, budget_max, allergies FROM customers").all<{
    id: string; lat: number; lng: number; genres: string; budget_max: number | null; allergies: string;
  }>();
  const started = performance.now();
  const candidates = rankCandidates(
    { genre: store.genre, avgPrice: store.avgPrice, allergens: store.allergens, location: { lat: store.lat, lng: store.lng } },
    rows.results.map((r) => ({ id: r.id, location: { lat: r.lat, lng: r.lng }, prefs: { genres: json(r.genres), budgetMax: r.budget_max, allergies: json(r.allergies) } })),
  );
  const matchMs = performance.now() - started;
  const expiresAt = now + CONFIG.offerTtlMs;
  const msg = await generateMessage(store.name, store.genre, perk, seats, expiresAt);
  const id = crypto.randomUUID();
  await db()
    .prepare(
      `INSERT INTO offers (id, store_id, seats, perk, message, message_source, llm_cost_usd, created_at, expires_at, status, cap, candidate_ids, waves, last_check_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, '[]', ?)`,
    )
    .bind(id, store.id, seats, perk, msg.message, msg.source, msg.costUsd, now, expiresAt, capFor(seats), JSON.stringify(candidates), now)
    .run();
  await tickOffer(id, now);
  return { id, evaluated: rows.results.length, candidates: candidates.length, matchMs, messageNote: msg.note ?? null };
};

export const stopOffer = async (store: Store, offerId: string) => {
  await db()
    .prepare("UPDATE offers SET status = 'stopped', stop_reason = '店主が「残席0」を押した' WHERE id = ? AND store_id = ? AND status = 'active'")
    .bind(offerId, store.id)
    .run();
};

const MAX_STEPS = 20;

/** オファーを今の時刻まで進める。遅れて呼ばれても、過ぎた待ち時間の分だけ順に判定する */
export const tickOffer = async (offerId: string, now = Date.now()) => {
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const o = await db().prepare("SELECT * FROM offers WHERE id = ?").bind(offerId).first<OfferRow>();
    if (!o || o.status !== "active") return;
    const counts = await db()
      .prepare(
        `SELECT COUNT(*) AS sent,
                SUM(CASE WHEN going_at IS NOT NULL THEN 1 ELSE 0 END) AS going,
                SUM(CASE WHEN going_at >= ? THEN 1 ELSE 0 END) AS recent
         FROM deliveries WHERE offer_id = ?`,
      )
      .bind(o.last_check_at, o.id)
      .first<{ sent: number; going: number | null; recent: number | null }>();
    const waves = json<Wave[]>(o.waves);
    const candidates = json<{ id: string; distanceM: number }[]>(o.candidate_ids);
    const sent = counts?.sent ?? 0;
    const d = decide(
      { status: "active", seats: o.seats, cap: o.cap, expiresAt: o.expires_at, candidateCount: candidates.length, waves, lastCheckAt: o.last_check_at },
      now, sent, counts?.recent ?? 0, counts?.going ?? 0,
    );
    if (d.kind === "none") return;
    if (d.kind === "close") {
      await db().prepare("UPDATE offers SET status = ?, stop_reason = ? WHERE id = ? AND status = 'active'").bind(d.status, d.reason, o.id).run();
      return;
    }
    const nextWaves = d.kind === "send" ? [...waves, d.wave] : waves;
    const locked = await db()
      .prepare("UPDATE offers SET waves = ?, last_check_at = ? WHERE id = ? AND status = 'active' AND last_check_at = ? AND waves = ?")
      .bind(JSON.stringify(nextWaves), d.checkAt, o.id, o.last_check_at, o.waves)
      .run();
    if (locked.meta.changes !== 1) continue; // 別の画面が先に進めた。読み直す
    if (d.kind === "send" && d.wave.size > 0) {
      const slice = candidates.slice(sent, sent + d.wave.size);
      await db().batch(
        slice.map((c) =>
          db()
            .prepare("INSERT OR IGNORE INTO deliveries (offer_id, customer_id, wave, distance_m, sent_at) VALUES (?, ?, ?, ?, ?)")
            .bind(o.id, c.id, d.wave.index, c.distanceM, d.wave.sentAt),
        ),
      );
    }
  }
};

export const tickAllActive = async (now = Date.now()) => {
  const rows = await db().prepare("SELECT id FROM offers WHERE status = 'active'").all<{ id: string }>();
  for (const r of rows.results) await tickOffer(r.id, now);
};

export const dashboard = async (store: Store) => {
  const o = await db().prepare("SELECT * FROM offers WHERE store_id = ? ORDER BY created_at DESC LIMIT 1").bind(store.id).first<OfferRow>();
  if (o) await tickOffer(o.id);
  const offer = o ? await db().prepare("SELECT * FROM offers WHERE id = ?").bind(o.id).first<OfferRow>() : null;
  const stats = offer
    ? await db()
        .prepare(
          `SELECT COUNT(*) AS sent, COUNT(opened_at) AS opened, COUNT(going_at) AS going, COUNT(redeemed_at) AS redeemed
           FROM deliveries WHERE offer_id = ?`,
        )
        .bind(offer.id)
        .first<{ sent: number; opened: number; going: number; redeemed: number }>()
    : null;
  const customers = await db().prepare("SELECT COUNT(*) AS n, SUM(seeded) AS seeded FROM customers").first<{ n: number; seeded: number }>();
  return {
    store,
    registered: { total: customers?.n ?? 0, real: (customers?.n ?? 0) - (customers?.seeded ?? 0) },
    config: { waveWaitSeconds: CONFIG.waveWaitMs / 1000, firstWaveSize: CONFIG.firstWaveSize, capPerSeat: CONFIG.capPerSeat, radiusM: CONFIG.walkMetersPerMinute * CONFIG.maxWalkMinutes },
    offer: offer && {
      id: offer.id, seats: offer.seats, perk: offer.perk, message: offer.message, messageSource: offer.message_source, llmCostUsd: offer.llm_cost_usd,
      createdAt: offer.created_at, expiresAt: offer.expires_at, status: offer.status, stopReason: offer.stop_reason, cap: offer.cap,
      candidates: json<unknown[]>(offer.candidate_ids).length, waves: json<Wave[]>(offer.waves), lastCheckAt: offer.last_check_at,
    },
    stats,
  };
};

// ---- 客 ----

export type RegisterInput = { name: string; text: string; spot: string; lat: number; lng: number };

export const registerCustomer = async (input: RegisterInput) => {
  const outcome = await structurePrefs(input.text);
  if (!outcome.ok) return outcome;
  const id = crypto.randomUUID();
  const p: Prefs = outcome.prefs;
  await db()
    .prepare("INSERT INTO customers VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)")
    .bind(id, input.name, input.spot, input.lat, input.lng, JSON.stringify(p.genres), p.budgetMax, JSON.stringify(p.allergies), outcome.source, Date.now())
    .run();
  return { ...outcome, id };
};

export const inbox = async (customerId: string) => {
  await tickAllActive();
  const rows = await db()
    .prepare(
      `SELECT d.*, o.message, o.message_source, o.perk, o.status, o.expires_at, s.name AS store_name
       FROM deliveries d JOIN offers o ON o.id = d.offer_id JOIN stores s ON s.id = o.store_id
       WHERE d.customer_id = ? ORDER BY d.sent_at DESC LIMIT 20`,
    )
    .bind(customerId)
    .all();
  return rows.results;
};

export type CustomerAction = "open" | "going" | "redeem";

export const act = async (customerId: string, offerId: string, action: CustomerAction) => {
  const now = Date.now();
  const offer = await db().prepare("SELECT status, expires_at FROM offers WHERE id = ?").bind(offerId).first<{ status: string; expires_at: number }>();
  if (!offer) throw new Error("オファーがありません");
  const live = offer.status === "active" || offer.status === "capped" || offer.status === "exhausted";
  if (action !== "open" && (!live || now >= offer.expires_at)) throw new Error("このオファーは終了しました（満席または期限切れ）");
  const column = { open: "opened_at", going: "going_at", redeem: "redeemed_at" }[action];
  await db()
    .prepare(`UPDATE deliveries SET ${column} = COALESCE(${column}, ?), opened_at = COALESCE(opened_at, ?) WHERE offer_id = ? AND customer_id = ?`)
    .bind(now, now, offerId, customerId)
    .run();
};
