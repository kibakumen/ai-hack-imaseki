// 取得の入口の検査（要件3〜7・27・33）。
//
// ⚠️ なぜ受け入れ検査とは別に置くか: 受け入れ検査 r03・r04・r05・r07・r27・r33 が場面を作るのに使う
// 入口（店の情報・許可書・カード・クーポン・承認・公開）は別のタスクの持ち場で、並行作業の作業ツリーには
// まだ無い。ここでは D1 に直に行を入れて、取得の入口だけを歩く。統合後は受け入れ検査が同じことを
// 場面ごと見るので、この検査はその下敷き（速く回る方）として残す。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHasher, createRng } from "../../adapters/webcrypto";
import { TEXTS } from "../../domain/texts";
import type { AiSelectInput, AiSelectResult, Clock, Deps, Geocoder, Logger } from "../../ports";
import { CUSTOMER_COOKIE_NAME } from "../cookies";
import { createApp } from "../app";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const ORIGIN = "https://app.test";
const T0 = "2026-09-22T06:00:00.000Z";
const SHIBUYA = { lat: 35.6595, lng: 139.7005 };
const EARTH_R = 6_371_000;
/** 起点から北へ meters 進んだ点 */
const north = (meters: number) => ({ lat: SHIBUYA.lat + (meters / EARTH_R) * (180 / Math.PI), lng: SHIBUYA.lng });

// ---------- 偽の差し替え口 ----------
type FakeClock = Clock & { advance(ms: number): Promise<void> };
const fakeClock = (): FakeClock => {
  let t = new Date(T0).getTime();
  const waiters: Array<{ at: number; resolve: () => void }> = [];
  return {
    now: () => new Date(t),
    after: (ms) => new Promise<void>((resolve) => waiters.push({ at: t + ms, resolve })),
    advance: async (ms) => {
      t += ms;
      for (const w of [...waiters]) {
        if (w.at <= t) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve();
        }
      }
      for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
    },
  };
};

const selectionText = (items: Array<{ storeId: string; reason: string }>) => JSON.stringify({ selections: items });

type Responder = (input: AiSelectInput) => AiSelectResult | Promise<AiSelectResult>;
type FakeAi = Deps["ai"] & { calls: AiSelectInput[]; respond: (fn: Responder) => void };
const fakeAi = (): FakeAi => {
  let responder: Responder = (input) => ({ ok: true, text: selectionText(input.stores.slice(0, 5).map((s) => ({ storeId: s.id, reason: `${s.genres[0] ?? "お店"}で好みに合います` }))), costUsd: 0.0012 });
  const ai: FakeAi = {
    calls: [],
    respond: (fn) => {
      responder = fn;
    },
    select: async (input) => {
      ai.calls.push(JSON.parse(JSON.stringify(input)) as AiSelectInput);
      return responder(input);
    },
  };
  return ai;
};

type GeocodeAnswer = { lat: number; lng: number } | "none" | "fail" | "hang";
type FakeGeocoder = Geocoder & { set: (text: string, result: GeocodeAnswer) => void };
const fakeGeocoder = (): FakeGeocoder => {
  const table = new Map<string, GeocodeAnswer>();
  return {
    set: (text, result) => {
      table.set(text, result);
    },
    geocode: async (text, opts) => {
      const found = table.get(text) ?? "none";
      if (found === "none") return { ok: false };
      if (found === "fail") throw new Error("geocoder failure");
      // 打ち切りの合図が来るまで返らない（受け入れ検査の偽の地図と同じ振る舞い）
      if (found === "hang") return new Promise<{ ok: false }>((resolve) => opts?.signal?.addEventListener("abort", () => resolve({ ok: false })));
      return { ok: true, lat: found.lat, lng: found.lng };
    },
  };
};

const fakeLogger = (): Logger & { entries: unknown[] } => {
  const entries: unknown[] = [];
  return { entries, log: (entry) => entries.push(entry) };
};

// ---------- 手元の D1 ----------
type Db = Deps["db"];
const openDb = async (): Promise<{ db: Db; dispose: () => Promise<void> }> => {
  const { getPlatformProxy } = await import("wrangler");
  const persist = fs.mkdtempSync(path.join(os.tmpdir(), "task11-fetch-"));
  const proxy = await getPlatformProxy<{ DB: Db }>({ configPath: path.join(WEB, "wrangler.jsonc"), persist: { path: persist } });
  const db = proxy.env.DB;
  const dir = path.join(WEB, "migrations");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = fs.readFileSync(path.join(dir, file), "utf8").replace(/--[^\n]*/g, "");
    for (const statement of sql.split(";").map((s) => s.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  return {
    db,
    dispose: async () => {
      await proxy.dispose();
      fs.rmSync(persist, { recursive: true, force: true });
    },
  };
};

const rows = async (db: Db, sql: string, ...params: unknown[]): Promise<Record<string, unknown>[]> => ((await db.prepare(sql).bind(...params).all()).results ?? []) as Record<string, unknown>[];
const one = async (db: Db, sql: string, ...params: unknown[]): Promise<Record<string, unknown> | null> => (await rows(db, sql, ...params))[0] ?? null;

// ---------- 場面の準備（入口がまだ無いので表に直に入れる） ----------
type SeedStore = { id: string; lat?: number; lng?: number; genres?: string[]; menus?: string[]; budgetMin?: number; budgetMax?: number; url?: string | null; createdAt?: string; status?: string };
type SeedOffer = { id: string; storeId: string; capacity?: number; partyMax?: number; untilAt?: string; couponIds?: string[]; endedAt?: string | null };

const seedStore = async (db: Db, store: SeedStore): Promise<void> => {
  const point = { lat: store.lat ?? SHIBUYA.lat, lng: store.lng ?? SHIBUYA.lng };
  await db
    .prepare(`INSERT INTO stores (id, name, status, address, lat, lng, url, genres, menus, budget_min, budget_max, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`)
    .bind(
      store.id,
      `店 ${store.id}`,
      store.status ?? "approved",
      `住所 ${store.id}`,
      point.lat,
      point.lng,
      store.url === undefined ? `https://example.com/${store.id}` : store.url,
      JSON.stringify(store.genres ?? ["和食"]),
      JSON.stringify(store.menus ?? ["刺身盛り"]),
      store.budgetMin ?? 2000,
      store.budgetMax ?? 4000,
      store.createdAt ?? T0,
    )
    .run();
};

const seedOffer = async (db: Db, offer: SeedOffer): Promise<void> => {
  const capacity = offer.capacity ?? 3;
  await db
    .prepare(`INSERT INTO offers (id, store_id, capacity, initial_capacity, party_max, published_at, until_at, coupon_ids, ended_at) VALUES (?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7, ?8)`)
    .bind(offer.id, offer.storeId, capacity, offer.partyMax ?? 4, T0, offer.untilAt ?? "2026-09-22T14:00:00.000Z", JSON.stringify(offer.couponIds ?? []), offer.endedAt ?? null)
    .run();
};

const seedCoupon = async (db: Db, coupon: { id: string; storeId: string; name: string; note: string }): Promise<void> => {
  await db.prepare(`INSERT INTO coupons (id, store_id, name, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(coupon.id, coupon.storeId, coupon.name, coupon.note, T0).run();
};

/** 公開中のオファーを場面ごと入れ替える（確保が指しているので先に外す）。 */
const clearOffers = async (db: Db): Promise<void> => {
  await db.prepare("DELETE FROM reservations").run();
  await db.prepare("DELETE FROM offers WHERE id IS NOT NULL").run();
};

const NICKNAME = "ひみつのなまえ";
const PHONE = "08000000001";

describe("取得の入口 POST /api/customer/fetch", () => {
  let db: Db;
  let dispose: () => Promise<void>;
  let clock: FakeClock;
  let ai: FakeAi;
  let geocoder: FakeGeocoder;
  let logger: ReturnType<typeof fakeLogger>;
  let deps: Deps;
  let cookie: string;

  const post = async (body: unknown): Promise<{ status: number; json: Record<string, unknown> }> => {
    const app = createApp(deps);
    const res = await app.fetch(
      new Request(`${ORIGIN}/api/customer/fetch`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, cookie }, body: JSON.stringify(body) }),
    );
    return { status: res.status, json: (await res.json()) as Record<string, unknown> };
  };
  const search = async (over: Record<string, unknown> = {}) => post({ lat: SHIBUYA.lat, lng: SHIBUYA.lng, party: 2, genres: [], budgetMax: null, ...over });
  const items = (result: { json: Record<string, unknown> }) => result.json.items as Array<Record<string, unknown>>;

  beforeAll(async () => {
    ({ db, dispose } = await openDb());
    clock = fakeClock();
    ai = fakeAi();
    geocoder = fakeGeocoder();
    logger = fakeLogger();
    const hasher = createHasher();
    deps = { db, ai, geocoder, logger, clock, rng: createRng(), hasher, config: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null, orcarouterModel: "orcarouter/auto" } } as unknown as Deps;
    const token = "abcdefghijklmnopqrstuv";
    cookie = `${CUSTOMER_COOKIE_NAME}=${token}`;
    await db
      .prepare(`INSERT INTO customers (id, nickname, phone, genres, budget_max, token_hash) VALUES (?1, ?2, ?3, '["和食"]', 4000, ?4)`)
      .bind("cust-1", NICKNAME, PHONE, await hasher.sha256Hex(token))
      .run();
  });
  afterAll(async () => {
    await dispose();
  });
  beforeEach(() => {
    ai.respond((input) => ({ ok: true, text: selectionText(input.stores.slice(0, 5).map((s) => ({ storeId: s.id, reason: "近くて好みに合います" }))), costUsd: 0.0012 }));
  });

  it("3.3・3.10・3.11 人数と場所の文字の範囲を入口が断る（項目ごとの理由つき）", async () => {
    expect((await search({ party: 0 })).json).toMatchObject({ error: { kind: "invalid_input", fields: [{ name: "party", reason: "out_of_range" }] } });
    expect((await search({ party: 11 })).json).toMatchObject({ error: { fields: [{ name: "party", reason: "out_of_range" }] } });
    expect((await search({ party: 2.5 })).json).toMatchObject({ error: { fields: [{ name: "party", reason: "not_integer" }] } });
    expect((await post({ lat: SHIBUYA.lat, lng: SHIBUYA.lng, genres: [], budgetMax: null })).json).toMatchObject({ error: { fields: [{ name: "party", reason: "required" }] } });
    expect((await search({ place: "あ".repeat(51) })).json).toMatchObject({ error: { fields: [{ name: "place", reason: "too_long" }] } });
    expect((await search({ party: 1 })).status).toBe(200);
    expect((await search({ party: 10 })).status).toBe(200);
    expect(await rows(db, "SELECT id FROM fetch_logs")).toHaveLength(2);
  });

  it("3.2・3.4・3.5・3.6 場所の文字が現在地に優先し、直せない・失敗・日本の外では取得を行わない", async () => {
    geocoder.set("渋谷駅", SHIBUYA);
    geocoder.set("失敗する場所", "fail");
    geocoder.set("サンフランシスコ", { lat: 37.77, lng: -122.41 });
    await seedStore(db, { id: "s-place" });
    await seedOffer(db, { id: "o-place", storeId: "s-place" });

    const ok = await search({ place: "渋谷駅", lat: 35.0, lng: 135.0 });
    expect(ok.status).toBe(200);
    expect(items(ok).map((i) => i.storeId)).toEqual(["s-place"]);
    const log = await one(db, "SELECT origin_lat, origin_lng FROM fetch_logs WHERE id = ?1", ok.json.fetchId);
    expect(log?.origin_lat).toBeCloseTo(SHIBUYA.lat, 4);

    for (const place of ["どこにもない場所", "失敗する場所", "サンフランシスコ"]) {
      const before = (await rows(db, "SELECT id FROM fetch_logs")).length;
      const calls = ai.calls.length;
      const refused = await search({ place });
      expect(refused.status, place).toBe(400);
      expect(refused.json, place).toMatchObject({ error: { kind: "place_unresolved", fields: [{ name: "place" }] } });
      expect((await rows(db, "SELECT id FROM fetch_logs")).length, place).toBe(before);
      expect(ai.calls.length, place).toBe(calls);
    }
  });

  it("3.5 返らない地図のサービスを、要求の外から時計を進めた場合（受け入れ検査と同じ形）でも打ち切って断る", async () => {
    geocoder.set("返らない場所", "hang");
    const before = (await rows(db, "SELECT id FROM fetch_logs")).length;
    const calls = ai.calls.length;
    // ⚠️ この進め方は、手続きが合図を作るより先に「今」を動かす（見分けの問い合わせの途中で進む）。
    // 差し替えた時計の合図はもう鳴らないので、実時計の打ち切り（AbortSignal.timeout）だけが残る。
    const pending = search({ place: "返らない場所" });
    await clock.advance(3_100);
    const refused = await pending;
    expect(refused.status).toBe(400);
    expect(refused.json).toMatchObject({ error: { kind: "place_unresolved" } });
    expect((await rows(db, "SELECT id FROM fetch_logs")).length).toBe(before);
    expect(ai.calls.length).toBe(calls);
  });

  it("5.2 受け取れる状態のオファーだけが候補になる（止めた・時刻を過ぎた・残り0・店が止められた）", async () => {
    await clearOffers(db);
    await seedStore(db, { id: "s-ok" });
    await seedStore(db, { id: "s-stopped" });
    await seedStore(db, { id: "s-past" });
    await seedStore(db, { id: "s-full" });
    await seedStore(db, { id: "s-banned", status: "banned" });
    await seedOffer(db, { id: "o-ok", storeId: "s-ok" });
    await seedOffer(db, { id: "o-stopped", storeId: "s-stopped", endedAt: T0 });
    await seedOffer(db, { id: "o-past", storeId: "s-past", untilAt: "2026-09-22T05:00:00.000Z" });
    await seedOffer(db, { id: "o-full", storeId: "s-full", capacity: 1 });
    await seedOffer(db, { id: "o-banned", storeId: "s-banned" });
    await db
      .prepare(`INSERT INTO reservations (id, offer_id, store_id, customer_id, fetch_id, party, code, created_at, expires_at, status, status_at) VALUES ('r1', 'o-full', 's-full', 'cust-1', 'f0', 2, '99999999', ?1, ?2, 'active', ?1)`)
      .bind(T0, "2026-09-22T06:20:00.000Z")
      .run();

    expect(items(await search()).map((i) => i.storeId)).toEqual(["s-ok"]);
  });

  it("4.1・4.2・4.3・7.11・6.6 7件→5件・3件→3件・0件では AI を呼ばず誤りにしない", async () => {
    await clearOffers(db);
    for (let i = 0; i < 7; i++) {
      await seedStore(db, { id: `s7-${i}`, ...north(30 * i) });
      await seedOffer(db, { id: `o7-${i}`, storeId: `s7-${i}` });
    }
    expect(items(await search())).toHaveLength(5);

    await db.prepare("DELETE FROM offers WHERE id IN ('o7-3','o7-4','o7-5','o7-6')").run();
    expect(items(await search())).toHaveLength(3);

    await clearOffers(db);
    const calls = ai.calls.length;
    const zero = await search();
    expect(zero.status).toBe(200);
    expect(zero.json.ok).toBe(true);
    expect(items(zero)).toEqual([]);
    expect(ai.calls.length).toBe(calls);
    // 27.5 0件の取得も記録は1件残る
    expect(await one(db, "SELECT candidate_count, returned_count FROM fetch_logs WHERE id = ?1", zero.json.fetchId)).toMatchObject({ candidate_count: 0, returned_count: 0 });
  });

  it("4.6〜4.10 1件の項目が揃い、クーポンは作った順・見せているものだけ、徒歩は切り上げ、URL の有無が映る", async () => {
    await clearOffers(db);
    await seedStore(db, { id: "s-near", ...north(5) });
    await seedStore(db, { id: "s-far", ...north(650), url: null });
    await seedCoupon(db, { id: "c1", storeId: "s-near", name: "先に作った", note: "1組1回" });
    await seedCoupon(db, { id: "c2", storeId: "s-near", name: "後に作った", note: "" });
    await seedCoupon(db, { id: "c3", storeId: "s-near", name: "見せていない", note: "" });
    await seedOffer(db, { id: "o-near", storeId: "s-near", couponIds: ["c2", "c1"] });
    await seedOffer(db, { id: "o-far", storeId: "s-far" });

    const result = await search();
    const near = items(result).find((i) => i.storeId === "s-near");
    expect(near).toMatchObject({ offerId: "o-near", storeName: "店 s-near", walkMinutes: 1, budgetMin: 2000, budgetMax: 4000, partyMax: 4, storeUrl: "https://example.com/s-near" });
    expect(typeof near?.reason).toBe("string");
    expect(near?.coupons).toEqual([{ name: "先に作った", note: "1組1回" }, { name: "後に作った", note: "" }]);
    const far = items(result).find((i) => i.storeId === "s-far");
    expect(far).toMatchObject({ walkMinutes: 9, storeUrl: null, coupons: [] });
  });

  it("4.12 並びは AI が返した順ではなく点数順（好みが変われば並びも変わる）", async () => {
    await clearOffers(db);
    await seedStore(db, { id: "s-a", ...north(10), genres: ["和食"] });
    await seedStore(db, { id: "s-b", ...north(300), genres: ["和食"] });
    await seedStore(db, { id: "s-d", ...north(10), genres: ["中華"] });
    for (const id of ["a", "b", "d"]) await seedOffer(db, { id: `o-${id}`, storeId: `s-${id}` });
    ai.respond((input) => ({ ok: true, text: selectionText([...input.stores].reverse().map((s) => ({ storeId: s.id, reason: "合います" }))), costUsd: 0 }));

    expect(items(await search({ genres: ["和食"] })).map((i) => i.storeId)).toEqual(["s-a", "s-b", "s-d"]);
    expect(items(await search({ genres: ["中華"] })).map((i) => i.storeId)).toEqual(["s-d", "s-a", "s-b"]);
  });

  it("7.1・7.2・28.3 渡る中身は店の姿とその回の条件だけ。候補が何件でも呼び出しは1回", async () => {
    await clearOffers(db);
    for (let i = 0; i < 12; i++) {
      await seedStore(db, { id: `sa-${i}`, ...north(40 * i), genres: [i % 2 ? "和食" : "中華"], menus: [`名物${i}`], budgetMin: 1000 + i * 100, budgetMax: 3000 + i * 100 });
      await seedOffer(db, { id: `oa-${i}`, storeId: `sa-${i}` });
    }
    const before = ai.calls.length;
    const result = await search({ party: 3, genres: ["和食"], budgetMax: 3500 });
    expect(result.status).toBe(200);
    expect(ai.calls.length).toBe(before + 1);

    const input = ai.calls.at(-1);
    expect(input).toMatchObject({ party: 3, genres: ["和食"], budgetMax: 3500 });
    expect(input?.stores).toHaveLength(10);
    for (const store of input?.stores ?? []) {
      expect(store.genres.length).toBeGreaterThan(0);
      expect(store.menus.length).toBeGreaterThan(0);
      expect(store.budgetMin).toBeLessThanOrEqual(store.budgetMax);
    }
    const text = JSON.stringify(input);
    expect(text).not.toContain(NICKNAME);
    expect(text).not.toContain(PHONE);

    // 予算の上限を下げると渡る店が減る（絞り込みが効いている）
    await search({ budgetMax: 1050 });
    expect(ai.calls.at(-1)?.stores.length).toBeLessThan(10);
  });

  it("7.6・7.7・7.8・7.9 失敗・打ち切り・検査落ちのどれでも点数順の上位5件と決まった文に倒れる", async () => {
    await clearOffers(db);
    for (let i = 0; i < 6; i++) {
      await seedStore(db, { id: `sf-${i}`, ...north(30 * i) });
      await seedOffer(db, { id: `of-${i}`, storeId: `sf-${i}` });
    }
    ai.respond(() => ({ ok: false, error: "upstream 500" }));
    const failed = await search();
    expect(items(failed)).toHaveLength(5);
    for (const item of items(failed)) expect(item.reason).toBe(TEXTS.fallbackReason);
    expect(await one(db, "SELECT ai_used FROM fetch_logs WHERE id = ?1", failed.json.fetchId)).toMatchObject({ ai_used: 0 });
    expect(await one(db, "SELECT succeeded, validation_failed FROM ai_calls WHERE fetch_id = ?1", failed.json.fetchId)).toMatchObject({ succeeded: 0, validation_failed: 0 });

    // 7.7 渡していない店・6件・61字は検査に落ち、同じ倒れ方をする（ai_calls は成功＋検査落ち）
    for (const text of [
      selectionText([{ storeId: "not-a-candidate", reason: "x" }]),
      selectionText(Array.from({ length: 6 }, (_, i) => ({ storeId: `sf-${i}`, reason: "x" }))),
      selectionText([{ storeId: "sf-1", reason: "あ".repeat(61) }]),
    ]) {
      ai.respond(() => ({ ok: true, text, costUsd: 0.001 }));
      const refused = await search();
      expect(items(refused)).toHaveLength(5);
      expect(items(refused).map((i) => i.storeId)).toEqual(items(failed).map((i) => i.storeId));
      expect(await one(db, "SELECT ai_used FROM fetch_logs WHERE id = ?1", refused.json.fetchId)).toMatchObject({ ai_used: 0 });
      expect(await one(db, "SELECT succeeded, validation_failed FROM ai_calls WHERE fetch_id = ?1", refused.json.fetchId)).toMatchObject({ succeeded: 1, validation_failed: 1 });
    }

    // 7.5 AI が0件を選んだら0件のまま（倒さない）
    ai.respond(() => ({ ok: true, text: selectionText([]), costUsd: 0.001 }));
    const empty = await search();
    expect(items(empty)).toEqual([]);
    expect(await one(db, "SELECT ai_used FROM fetch_logs WHERE id = ?1", empty.json.fetchId)).toMatchObject({ ai_used: 1 });
  });

  it("7.6 6秒返らない AI（偽の時計）でも点数順に倒れ、例外が外へ出ない", async () => {
    await clearOffers(db);
    await seedStore(db, { id: "s-slow" });
    await seedOffer(db, { id: "o-slow", storeId: "s-slow" });
    ai.respond(async () => {
      await clock.advance(6_100);
      return { ok: true, text: selectionText([{ storeId: "s-slow", reason: "合います" }]), costUsd: 0.001 };
    });
    const slow = await search();
    expect(slow.status).toBe(200);
    expect(items(slow)).toHaveLength(1);
    expect(items(slow)[0].reason).toBe(TEXTS.fallbackReason);
    expect(await one(db, "SELECT ai_used FROM fetch_logs WHERE id = ?1", slow.json.fetchId)).toMatchObject({ ai_used: 0 });

    // AI が例外を投げても取得は成立する（点数順に倒れる）
    ai.respond(() => {
      throw new Error("AI down");
    });
    const thrown = await search();
    expect(thrown.status).toBe(200);
    expect(items(thrown)[0].reason).toBe(TEXTS.fallbackReason);
  });

  it("27.1・27.2・27.6・33.1・33.2・33.3 記録の中身（順位・点数・理由・所要時間・実費）と、個人データが無いこと", async () => {
    await clearOffers(db);
    for (let i = 0; i < 3; i++) {
      await seedStore(db, { id: `sl-${i}`, ...north(30 * i) });
      await seedOffer(db, { id: `ol-${i}`, storeId: `sl-${i}` });
    }
    ai.respond(async (input) => {
      await clock.advance(1_234);
      return { ok: true, text: selectionText(input.stores.map((s) => ({ storeId: s.id, reason: "近くて好みに合います" }))), costUsd: 0.0077 };
    });
    const before = (await rows(db, "SELECT id FROM fetch_logs")).length;
    const usedAt = clock.now().toISOString();
    const result = await search({ party: 3, genres: ["和食", "中華"], budgetMax: 2500 });
    expect((await rows(db, "SELECT id FROM fetch_logs")).length).toBe(before + 1);

    const log = await one(db, "SELECT * FROM fetch_logs WHERE id = ?1", result.json.fetchId);
    expect(log).toMatchObject({ at: usedAt, customer_id: "cust-1", party: 3, budget_max: 2500, candidate_count: 3, returned_count: 3, ai_used: 1 });
    expect(JSON.parse(String(log?.genres))).toEqual(["和食", "中華"]);
    expect(Number(log?.duration_ms)).toBeGreaterThanOrEqual(1234);

    const stored = await rows(db, "SELECT rank, score, reason, store_id FROM fetch_items WHERE fetch_id = ?1 ORDER BY rank", result.json.fetchId);
    expect(stored.map((i) => i.store_id)).toEqual(items(result).map((i) => i.storeId));
    expect(stored.map((i) => i.rank)).toEqual([1, 2, 3]);
    for (const [index, item] of stored.entries()) {
      expect(typeof item.score).toBe("number");
      expect(item.reason).toBe(items(result)[index].reason);
    }
    expect(await one(db, "SELECT cost_usd, duration_ms, succeeded FROM ai_calls WHERE fetch_id = ?1", result.json.fetchId)).toMatchObject({ cost_usd: 0.0077, duration_ms: 1234, succeeded: 1 });

    // 27.2 倒れた取得は理由を空で残す
    ai.respond(() => ({ ok: false, error: "down", costUsd: null }));
    const fell = await search();
    for (const item of await rows(db, "SELECT reason FROM fetch_items WHERE fetch_id = ?1", fell.json.fetchId)) expect(item.reason ?? "").toBe("");
    expect(await one(db, "SELECT cost_usd, succeeded FROM ai_calls WHERE fetch_id = ?1", fell.json.fetchId)).toMatchObject({ cost_usd: null, succeeded: 0 });

    // 27.6 どの記録の列にも呼び名と電話番号が無い
    for (const table of ["fetch_logs", "fetch_items", "ai_calls"]) {
      const all = JSON.stringify(await rows(db, `SELECT * FROM "${table}"`));
      expect(all, table).not.toContain(NICKNAME);
      expect(all, table).not.toContain(PHONE);
    }
    // ログの出口にも自由な文字列を渡していない
    for (const entry of logger.entries as Record<string, unknown>[]) {
      for (const [key, value] of Object.entries(entry)) if (typeof value === "string") expect(["event", "errorKind", "id"]).toContain(key);
    }
  });

  it("3.14・3.15 その回だけ変えた好み・予算・起点を客の登録に書き戻さない", async () => {
    const before = await one(db, "SELECT * FROM customers WHERE id = 'cust-1'");
    await search({ party: 5, genres: ["中華", "焼肉"], budgetMax: 1500, lat: 35.7, lng: 139.8 });
    expect(await one(db, "SELECT * FROM customers WHERE id = 'cust-1'")).toEqual(before);
  });
});
