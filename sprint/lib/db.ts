import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  newCode,
  newId,
  parseMenus,
  rankStores,
  type Candidate,
  type Menu,
  type Offer,
  type Prefs,
  type Store,
} from "./core";
import { FALLBACK_REASON, selectStores, structurePrefs } from "./llm";

export const db = () => getCloudflareContext().env.DB;

export const sha256Hex = async (value: string) => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
};

export const storeByKey = async (key: string): Promise<Store | null> => {
  const hash = await sha256Hex(key);
  return db().prepare("SELECT * FROM s_stores WHERE key_hash = ?").bind(hash).first<Store>();
};

export const adminOk = (key: string) => key === (process.env.ADMIN_KEY ?? "unei2026");

// ---- 客 ----

export const registerCustomer = async (name: string, phone: string, text: string) => {
  const { prefs, source, costUsd } = await structurePrefs(text);
  const id = newId("c");
  const now = Date.now();
  await db()
    .prepare("INSERT INTO s_customers (id, name, phone, prefs, prefs_source, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, name, phone, JSON.stringify(prefs), source, now)
    .run();
  return { id, name, prefs, source, costUsd };
};

export const getCustomer = async (id: string) => {
  const row = await db().prepare("SELECT * FROM s_customers WHERE id = ?").bind(id).first<{ id: string; name: string; phone: string; prefs: string; prefs_source: string }>();
  if (!row) return null;
  return { ...row, prefsParsed: JSON.parse(row.prefs) as Prefs };
};

export type SearchResult = {
  requestId: string;
  aiUsed: boolean;
  costUsd: number | null;
  evaluated: number;
  candidates: number;
  matchMs: number;
  items: {
    storeId: string; name: string; genre: string; address: string; url: string; priceAvg: number;
    walkMin: number; distance: number; reason: string; menus: Menu[];
    offers: { id: string; title: string; partySize: number; remaining: number; couponNote: string; takeable: boolean; reason: string | null; recommended: boolean; window: string }[];
  }[];
};

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export const search = async (customerId: string, lat: number, lng: number, party: number): Promise<SearchResult> => {
  const customer = await getCustomer(customerId);
  if (!customer) throw new Error("登録が見つかりません");
  const now = Date.now();
  const [storesRes, offersRes] = await Promise.all([
    db().prepare("SELECT * FROM s_stores").all<Store>(),
    db().prepare("SELECT * FROM s_offers").all<Offer>(),
  ]);
  const started = performance.now();
  const ranked = rankStores({
    origin: { lat, lng },
    party,
    prefs: customer.prefsParsed,
    now,
    stores: storesRes.results ?? [],
    offers: offersRes.results ?? [],
  });
  const matchMs = performance.now() - started;

  const { picks, aiUsed, costUsd } = await selectStores(ranked, customer.prefsParsed, party);
  const byId = new Map<string, Candidate>(ranked.map((c) => [c.store.id, c]));
  const items: SearchResult["items"] = [];
  picks.forEach((pick) => {
    const c = byId.get(pick.storeId);
    if (!c) return;
    items.push({
      storeId: c.store.id,
      name: c.store.name,
      genre: c.store.genre,
      address: c.store.address,
      url: c.store.url,
      priceAvg: c.store.price_avg,
      walkMin: c.walkMin,
      distance: c.distance,
      reason: pick.reason,
      menus: c.menus.slice(0, 6),
      offers: c.offers.map((o) => ({
        id: o.id,
        title: o.title,
        partySize: o.party_size,
        remaining: o.remaining,
        couponNote: o.coupon_note,
        takeable: o.takeable,
        reason: o.reason,
        recommended: o.recommended,
        window: `${hhmm(o.start_min)}〜${hhmm(o.end_min)}`,
      })),
    });
  });

  const requestId = newId("r");
  await db()
    .prepare("INSERT INTO s_requests (id, customer_id, lat, lng, party, candidates, returned, ai_used, cost_usd, items, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .bind(
      requestId, customerId, lat, lng, party, ranked.length, items.length, aiUsed ? 1 : 0, costUsd,
      JSON.stringify(items.map((it, i) => ({ storeId: it.storeId, rank: i + 1, score: byId.get(it.storeId)?.score ?? null }))),
      now,
    )
    .run();

  return {
    requestId, aiUsed, costUsd,
    evaluated: (storesRes.results ?? []).length,
    candidates: ranked.length,
    matchMs,
    items,
  };
};

export const claim = async (customerId: string, offerId: string, party: number) => {
  const now = Date.now();
  const offer = await db().prepare("SELECT * FROM s_offers WHERE id = ?").bind(offerId).first<Offer>();
  if (!offer) throw new Error("オファーが見つかりません");
  const store = await db().prepare("SELECT * FROM s_stores WHERE id = ?").bind(offer.store_id).first<Store>();
  if (!store || store.approved !== 1) throw new Error("この店はいま受け取れません");
  if (offer.active === 0) throw new Error("店がこのオファーを止めています");
  if (party > offer.party_size) throw new Error(`${offer.party_size}名までのオファーです`);

  const held = await db()
    .prepare("SELECT * FROM s_claims WHERE customer_id = ? AND offer_id = ? AND used_at IS NULL AND expires_at > ?")
    .bind(customerId, offerId, now)
    .first<{ code: string; expires_at: number }>();
  if (held) return { code: held.code, expiresAt: held.expires_at, reused: true, storeName: store.name };

  // 残りを1つ取る（同時に受け取っても0を下回らない）
  const taken = await db()
    .prepare("UPDATE s_offers SET remaining = remaining - 1 WHERE id = ? AND remaining > 0")
    .bind(offerId)
    .run();
  if (!taken.meta.changes) throw new Error("残りがありません");

  const code = newCode();
  const expiresAt = now + 2 * 3600 * 1000;
  await db()
    .prepare("INSERT INTO s_claims (code, customer_id, offer_id, store_id, party, claimed_at, expires_at, used_at) VALUES (?,?,?,?,?,?,?,NULL)")
    .bind(code, customerId, offerId, offer.store_id, party, now, expiresAt)
    .run();
  return { code, expiresAt, reused: false, storeName: store.name };
};

export const myClaims = async (customerId: string) => {
  const rows = await db()
    .prepare(
      `SELECT c.code, c.claimed_at, c.expires_at, c.used_at, c.party, o.title, o.coupon_note, s.name AS store_name, s.address, s.url
       FROM s_claims c JOIN s_offers o ON o.id = c.offer_id JOIN s_stores s ON s.id = c.store_id
       WHERE c.customer_id = ? ORDER BY c.claimed_at DESC`,
    )
    .bind(customerId)
    .all();
  return rows.results ?? [];
};

// ---- 店 ----

export const storeDashboard = async (store: Store) => {
  const [offers, claims, shown] = await Promise.all([
    db().prepare("SELECT * FROM s_offers WHERE store_id = ? ORDER BY sort_order").bind(store.id).all<Offer>(),
    db()
      .prepare(
        `SELECT c.code, c.claimed_at, c.used_at, c.party, o.title, cu.name AS customer_name, cu.phone
         FROM s_claims c JOIN s_offers o ON o.id = c.offer_id JOIN s_customers cu ON cu.id = c.customer_id
         WHERE c.store_id = ? ORDER BY c.claimed_at DESC LIMIT 50`,
      )
      .bind(store.id)
      .all(),
    db().prepare("SELECT COUNT(*) AS n FROM s_requests WHERE items LIKE ?").bind(`%${store.id}%`).first<{ n: number }>(),
  ]);
  return {
    store: { ...store, menus: parseMenus(store.menus) },
    offers: offers.results ?? [],
    claims: claims.results ?? [],
    stats: {
      shown: shown?.n ?? 0,
      claimed: (claims.results ?? []).length,
      used: (claims.results ?? []).filter((c) => (c as { used_at: number | null }).used_at !== null).length,
    },
  };
};

export const saveStore = async (id: string, f: { address: string; url: string; genre: string; priceAvg: number; menus: Menu[] }) => {
  await db()
    .prepare("UPDATE s_stores SET address = ?, url = ?, genre = ?, price_avg = ?, menus = ? WHERE id = ?")
    .bind(f.address, f.url, f.genre, f.priceAvg, JSON.stringify(f.menus), id)
    .run();
};

export const saveOffer = async (
  storeId: string,
  f: { id?: string; title: string; partySize: number; qty: number; couponNote: string; startMin: number; endMin: number },
) => {
  if (f.id) {
    await db()
      .prepare("UPDATE s_offers SET title = ?, party_size = ?, qty = ?, remaining = ?, coupon_note = ?, start_min = ?, end_min = ? WHERE id = ? AND store_id = ?")
      .bind(f.title, f.partySize, f.qty, f.qty, f.couponNote, f.startMin, f.endMin, f.id, storeId)
      .run();
    return f.id;
  }
  const count = await db().prepare("SELECT COUNT(*) AS n FROM s_offers WHERE store_id = ?").bind(storeId).first<{ n: number }>();
  if ((count?.n ?? 0) >= 3) throw new Error("オファーは3つまでです");
  const id = newId("o");
  await db()
    .prepare("INSERT INTO s_offers (id, store_id, title, party_size, qty, remaining, coupon_note, start_min, end_min, active, sort_order, created_at) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)")
    .bind(id, storeId, f.title, f.partySize, f.qty, f.qty, f.couponNote, f.startMin, f.endMin, count?.n ?? 0, Date.now())
    .run();
  return id;
};

export const toggleOffer = async (storeId: string, offerId: string, active: boolean) => {
  await db().prepare("UPDATE s_offers SET active = ? WHERE id = ? AND store_id = ?").bind(active ? 1 : 0, offerId, storeId).run();
};

export const markUsed = async (storeId: string, code: string) => {
  const res = await db()
    .prepare("UPDATE s_claims SET used_at = ? WHERE code = ? AND store_id = ? AND used_at IS NULL")
    .bind(Date.now(), code, storeId)
    .run();
  if (!res.meta.changes) throw new Error("その番号は見つからないか、すでに使用済みです");
};

// ---- 運営 ----

export const adminList = async () => {
  const [stores, offers, counts] = await Promise.all([
    db().prepare("SELECT * FROM s_stores ORDER BY created_at").all<Store>(),
    db().prepare("SELECT * FROM s_offers ORDER BY store_id, sort_order").all<Offer>(),
    db().prepare("SELECT COUNT(*) AS customers FROM s_customers").first<{ customers: number }>(),
  ]);
  const claims = await db().prepare("SELECT store_id, COUNT(*) AS n FROM s_claims GROUP BY store_id").all<{ store_id: string; n: number }>();
  const claimBy = new Map((claims.results ?? []).map((r) => [r.store_id, r.n]));
  return {
    customers: counts?.customers ?? 0,
    stores: (stores.results ?? []).map((s) => ({
      ...s,
      menus: parseMenus(s.menus),
      offers: (offers.results ?? []).filter((o) => o.store_id === s.id),
      claims: claimBy.get(s.id) ?? 0,
    })),
  };
};

export const approveStore = async (id: string, approved: boolean) => {
  await db().prepare("UPDATE s_stores SET approved = ? WHERE id = ?").bind(approved ? 1 : 0, id).run();
};

export const FALLBACK_TEXT = FALLBACK_REASON;
