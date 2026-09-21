/* eslint-disable @typescript-eslint/no-explicit-any -- 応答と D1 の行は、この検査の中だけで読む値
   （受け入れ検査 tests/acceptance/v2/_fakes.ts と同じ扱い。応答の形の正本は schemas と _types.ts） */

// オファーの公開と停止の入口（要件17の基準 17.1〜17.14・17.17〜17.22・要件18の基準 18.10）。
//
// ⚠️ なぜ受け入れ検査と別に在るか: `tests/acceptance/v2/r17-publish.test.ts` は場面を作るのに
// 店の情報・許可書・カード・承認の入口（タスク5・6・7・8）を通る。この検査は**店の行を直接置いて**
// 同じ筋を見るので、それらが揃う前でも走る。揃ったあとも、公開の手続きだけを狭く見る検査として残す。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHasher, createRng } from "../../adapters/webcrypto";
import type { Deps } from "../../ports";
import { createApp } from "../app";
import { SESSION_COOKIE_NAME } from "../cookies";

const ORIGIN = "https://app.test";
/** 2026-09-22 15:00 JST */
const T0 = "2026-09-22T06:00:00.000Z";
const jst = (hhmm: string, dayOffset = 0): string => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 8, 22 + dayOffset, h - 9, m)).toISOString();
};

type Db = Deps["db"];
type App = { fetch(req: Request): Promise<Response> };
type Result = { status: number; json: any };

let db: Db;
let dispose: () => Promise<void>;
let app: App;
let clockNow = new Date(T0);
let seq = 0;

const hasher = createHasher();

const openDb = async () => {
  const { getPlatformProxy } = await import("wrangler");
  const web = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
  const persist = fs.mkdtempSync(path.join(os.tmpdir(), "ai-hack-offers-"));
  const proxy = await getPlatformProxy<{ DB: Db }>({ configPath: path.join(web, "wrangler.jsonc"), persist: { path: persist } });
  const dir = path.join(web, "migrations");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = fs.readFileSync(path.join(dir, file), "utf8").replace(/--[^\n]*/g, "");
    for (const statement of sql.split(";").map((s) => s.trim()).filter(Boolean)) await proxy.env.DB.prepare(statement).run();
  }
  return {
    db: proxy.env.DB,
    dispose: async () => {
      await proxy.dispose();
      fs.rmSync(persist, { recursive: true, force: true });
    },
  };
};

const rows = async (sql: string, ...params: unknown[]): Promise<any[]> => ((await db.prepare(sql).bind(...params).all()).results ?? []) as any[];
const one = async (sql: string, ...params: unknown[]): Promise<any> => (await rows(sql, ...params))[0] ?? null;

const call = async (method: string, pathname: string, cookie: string | null, body?: unknown): Promise<Result> => {
  const headers = new Headers({ origin: ORIGIN });
  if (body !== undefined) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  const res = await app.fetch(new Request(ORIGIN + pathname, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json };
};

type Seeded = { id: string; cookie: string; couponIds: string[] };

/** 店・アカウント・セッションを直接置く（タスク5〜8の入口を待たない）。 */
const seedStore = async (over: { status?: string; profile?: boolean; coupons?: string[] } = {}): Promise<Seeded> => {
  const n = ++seq;
  const id = `store-${n}`;
  const profile = over.profile ?? true;
  await db
    .prepare(
      `INSERT INTO stores (id, name, created_at, status, address, lat, lng, url, genres, menus, budget_min, budget_max)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
    )
    .bind(
      id,
      `店${n}`,
      T0,
      over.status ?? "approved",
      profile ? `東京都渋谷区道玄坂1-${n}` : null,
      profile ? 35.6595 : null,
      profile ? 139.7005 : null,
      null,
      JSON.stringify(profile ? ["和食"] : []),
      JSON.stringify([]),
      profile ? 2000 : null,
      profile ? 4000 : null,
    )
    .run();

  const token = `session-token-${n}`;
  await db
    .prepare(`INSERT INTO accounts (id, email, password_hash, role, store_id) VALUES (?1, ?2, 'x', 'store', ?3)`)
    .bind(`account-${n}`, `store${n}@example.com`, id)
    .run();
  await db
    .prepare(`INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?1, ?2, ?3)`)
    .bind(await hasher.sha256Hex(token), `account-${n}`, new Date(clockNow.getTime() + 25 * 60 * 60 * 1000).toISOString())
    .run();

  const couponIds: string[] = [];
  for (const [index, name] of (over.coupons ?? []).entries()) {
    const couponId = `coupon-${n}-${index}`;
    await db
      .prepare(`INSERT INTO coupons (id, store_id, name, note, created_at) VALUES (?1, ?2, ?3, '', ?4)`)
      .bind(couponId, id, name, new Date(clockNow.getTime() + index).toISOString())
      .run();
    couponIds.push(couponId);
  }
  return { id, cookie: `${SESSION_COOKIE_NAME}=${token}`, couponIds };
};

const body = (over: Record<string, unknown> = {}) => ({ couponIds: [], capacity: 3, partyMax: 4, until: "23:00", ...over });
const publish = (store: Seeded, over: Record<string, unknown> = {}) => call("POST", "/api/store/offers", store.cookie, body(over));
const stop = (store: Seeded) => call("POST", "/api/store/offers/current/stop", store.cookie, {});
const home = async (store: Seeded) => (await call("GET", "/api/store/home", store.cookie)).json;

beforeAll(async () => {
  const opened = await openDb();
  db = opened.db;
  dispose = opened.dispose;
  const deps = {
    db,
    clock: { now: () => clockNow, after: () => new Promise<void>(() => {}) },
    rng: createRng(),
    hasher,
  } as unknown as Deps;
  app = createApp(deps);
});

afterAll(async () => {
  await dispose();
});

describe("POST /api/store/offers（公開）", () => {
  it("17.1・17.2・18.10 公開でき、ホームに5項目が出る。クーポン0個の店も公開できる", async () => {
    clockNow = new Date(jst("15:00"));
    const store = await seedStore({ coupons: ["生ビール", "デザート"] });
    const published = await publish(store, { couponIds: [store.couponIds[0]], capacity: 5, partyMax: 6, until: "22:30" });
    expect(published.status).toBe(201);
    expect(published.json.offer).toMatchObject({ capacity: 5, remaining: 5, partyMax: 6 });

    const shown = await home(store);
    expect(shown.offer).toMatchObject({ capacity: 5, remaining: 5, partyMax: 6 });
    expect(shown.offer.untilAt).toBe(jst("22:30"));
    expect(shown.offer.latestUntil).toBe(jst("03:00", 1));
    expect(shown.offer.coupons.map((c: any) => c.name)).toEqual(["生ビール"]);

    const bare = await seedStore();
    expect((await publish(bare)).status).toBe(201);
    expect((await home(bare)).offer.coupons).toEqual([]);
  });

  it("17.3・17.4・17.6 範囲の外はどの項目かが fields で返り、公開されない。端の値は通る", async () => {
    for (const [over, field] of [
      [{ capacity: 0 }, "capacity"],
      [{ capacity: 21 }, "capacity"],
      [{ partyMax: 0 }, "partyMax"],
      [{ partyMax: 11 }, "partyMax"],
      [{ capacity: 2.5 }, "capacity"],
    ] as const) {
      const store = await seedStore();
      const refused = await publish(store, over);
      expect(refused.status, JSON.stringify(over)).toBe(400);
      expect(refused.json.error.kind).toBe("invalid_input");
      expect(refused.json.error.fields.map((f: any) => f.name)).toContain(field);
      expect((await home(store)).offer).toBeNull();
    }
    for (const over of [{ capacity: 1, partyMax: 1 }, { capacity: 20, partyMax: 10 }]) {
      const store = await seedStore();
      expect((await publish(store, over)).status, JSON.stringify(over)).toBe(201);
    }
  });

  it("17.5・17.6 何時まで: 今以前は in_past、枠の外は over_window、日付をまたぐ時刻は通る", async () => {
    clockNow = new Date(jst("15:00"));
    const cases: Array<[string, string | null]> = [
      ["15:00", "in_past"],
      ["14:59", "over_window"],
      ["03:01", "over_window"],
      ["03:00", null],
      ["02:00", null],
      ["15:01", null],
    ];
    for (const [until, reason] of cases) {
      const store = await seedStore();
      const result = await publish(store, { until });
      if (reason === null) {
        expect(result.status, until).toBe(201);
      } else {
        expect(result.status, until).toBe(400);
        expect(result.json.error.fields, until).toContainEqual({ name: "until", reason });
        expect((await home(store)).offer, until).toBeNull();
      }
    }
    const crossing = await seedStore();
    await publish(crossing, { until: "02:00" });
    expect((await home(crossing)).offer.untilAt).toBe(jst("02:00", 1));
  });

  it("17.9 公開中があると offer_exists。止めたあとは公開できる", async () => {
    clockNow = new Date(jst("15:00"));
    const store = await seedStore();
    expect((await publish(store)).status).toBe(201);
    const second = await publish(store);
    expect(second.status).toBe(409);
    expect(second.json.error.kind).toBe("offer_exists");
    expect((await stop(store)).status).toBe(200);
    expect((await publish(store)).status).toBe(201);
  });

  it("17.10 未承認と止められている店は公開を受け付けず、行も増えない", async () => {
    for (const status of ["pending", "banned"]) {
      const store = await seedStore({ status });
      const refused = await publish(store);
      expect(refused.status, status).toBe(409);
      expect(refused.json.error.kind, status).toBe("approval_missing");
      expect((await one("SELECT COUNT(*) AS n FROM offers WHERE store_id = ?1", store.id)).n, status).toBe(0);
    }
  });

  it("17.11 店の情報が空だと profile_incomplete で、足りない項目が返る（ホームの missingProfile と同じ）", async () => {
    const store = await seedStore({ profile: false });
    const refused = await publish(store);
    expect(refused.status).toBe(409);
    expect(refused.json.error.kind).toBe("profile_incomplete");
    const missing = refused.json.error.fields.map((f: any) => f.name);
    expect(missing).toContain("address");
    expect(missing).toContain("genres");
    expect((await home(store)).missingProfile).toEqual(expect.arrayContaining(["address", "genres"]));
  });
});

describe("POST /api/store/offers/current/stop（停止）", () => {
  it("17.12・17.13 止めると終わり（end_reason stopped）。2度目は offer_ended", async () => {
    clockNow = new Date(jst("15:00"));
    const store = await seedStore();
    const offerId = (await publish(store)).json.offer.id;
    expect((await stop(store)).status).toBe(200);
    const row = await one("SELECT ended_at, end_reason FROM offers WHERE id = ?1", offerId);
    expect(row.end_reason).toBe("stopped");
    expect(row.ended_at).toBe(jst("15:00"));
    expect((await home(store)).offer).toBeNull();
    const again = await stop(store);
    expect(again.status).toBe(409);
    expect(again.json.error.kind).toBe("offer_ended");
  });

  it("17.14 「何時まで」を過ぎると操作なしで終わる（書き込みは起きない）", async () => {
    clockNow = new Date(jst("15:00"));
    const store = await seedStore();
    const offerId = (await publish(store, { until: "15:10" })).json.offer.id;
    expect((await home(store)).offer.id).toBe(offerId);
    clockNow = new Date(jst("15:11"));
    expect((await home(store)).offer).toBeNull();
    expect((await one("SELECT ended_at FROM offers WHERE id = ?1", offerId)).ended_at).toBeNull();
  });
});

describe("公開中のクーポンの読み口（要件16の基準 16.5 の材料・断るのはタスク6）", () => {
  it("公開中のオファーが見せているクーポンだけが「使われている」。止めたあとは使われていない", async () => {
    clockNow = new Date(jst("15:00"));
    const { isCouponInUse } = await import("../../repo/offers");
    const store = await seedStore({ coupons: ["見せる", "見せない"] });
    const [shown, hidden] = store.couponIds;
    await publish(store, { couponIds: [shown] });
    const nowIso = clockNow.toISOString();
    expect(await isCouponInUse(db, store.id, shown, nowIso)).toBe(true);
    expect(await isCouponInUse(db, store.id, hidden, nowIso)).toBe(false);
    await stop(store);
    expect(await isCouponInUse(db, store.id, shown, clockNow.toISOString())).toBe(false);
  });
});

describe("GET /api/store/home（公開のフォームの初めの値）", () => {
  it("17.17・17.20 前回の値が出て、削除したクーポンは外れる", async () => {
    clockNow = new Date(jst("15:00"));
    const store = await seedStore({ coupons: ["a", "b"] });
    await publish(store, { capacity: 4, partyMax: 2, until: "21:00", couponIds: store.couponIds });
    await stop(store);
    await db.prepare(`DELETE FROM coupons WHERE id = ?1`).bind(store.couponIds[1]).run();
    expect((await home(store)).publishPrefill).toEqual({ couponIds: [store.couponIds[0]], capacity: 4, partyMax: 2, until: "21:00" });
  });

  it("17.21 前回が無ければどの欄も空", async () => {
    const store = await seedStore();
    expect((await home(store)).publishPrefill).toEqual({ couponIds: [], capacity: null, partyMax: null, until: null });
  });

  it("17.18・17.19 前回の「何時まで」は、今を起点にした枠に在れば入り、外れれば空欄", async () => {
    clockNow = new Date(jst("15:00"));
    const store = await seedStore();
    await publish(store, { until: "16:00" });
    await stop(store);
    // 15:30 の時点では、16:00 はまだ今より後で枠の内＝そのまま入る（基準 17.18）。
    clockNow = new Date(jst("15:30"));
    expect((await home(store)).publishPrefill.until).toBe("16:00");
    // 16:30 まで進むと、16:00 は翌日と読まれて枠（翌 04:30 まで）の外＝空欄（基準 17.19）。
    clockNow = new Date(jst("16:30"));
    expect((await home(store)).publishPrefill.until).toBeNull();
  });
});
