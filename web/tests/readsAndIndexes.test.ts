/* eslint-disable @typescript-eslint/no-explicit-any -- D1 の行と文は、この検査の中だけで読む値（受け入れ検査の _fakes と同じ扱い） */
// 読み取りの幅と索引（2026-09-25 監査の指摘 設計-08）と、店のホームの読み直し（設計-10 の②）。
//
// 設計-08: reservations(store_id)・fetch_items(store_id)・fetch_logs(customer_id) に索引が無く、開きっぱなしの
// 店の画面が30秒ごとに確保と記録の表を全部読んでいた。ここでは、その読み取りの文を実物のまま取り出し、
// EXPLAIN QUERY PLAN で表全体の走査（SCAN）になっていないことを見る。取得の候補は、起点の周りの四角形で
// 先に絞ってから読む。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvedStore, makeCtx, north, publishOffer, receivedScene, SHIBUYA, type Ctx, type Db } from "../../tests/acceptance/v2/_fakes";
import { distanceMeters, searchBounds, SEARCH_RADIUS_METERS } from "../lib/domain/geo";
import { listStoresForAdmin } from "../lib/repo/adminStores";
import { findFetchCandidates } from "../lib/repo/fetchCandidates";
import { insertExpiredEvents } from "../lib/repo/logs";
import { findLastFetchAt, listStoreArrivals } from "../lib/repo/reservations";
import { listOfferShownCounts, listReservationStatesOfStore } from "../lib/repo/storeResults";
import { interleaved } from "./_interleavedDb";

type Recorded = { sql: string; params: unknown[] };

/** repo の関数が投げる文を、D1 へ送らずに取り出す（どの行も無いものとして返す）。 */
const recordStatements = async (run: (db: Db) => Promise<unknown>): Promise<Recorded[]> => {
  const seen: Recorded[] = [];
  const empty = { results: [], success: true, meta: { changes: 0 } };
  const statement = (sql: string, params: unknown[] = []): any => ({
    __sql: sql,
    __params: params,
    bind: (...values: unknown[]) => statement(sql, values),
    first: async () => (seen.push({ sql, params }), null),
    all: async () => (seen.push({ sql, params }), empty),
    run: async () => (seen.push({ sql, params }), empty),
    raw: async () => (seen.push({ sql, params }), []),
  });
  const db: Db = {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: any[]) => (statements.forEach((s) => seen.push({ sql: s.__sql, params: s.__params })), statements.map(() => empty)),
    exec: async () => ({}),
  };
  await run(db);
  return seen;
};

/**
 * 索引を使わずに読む行（`USING` の無い SCAN・SEARCH）のうち、確保・記録・オファーの表に当たるもの。
 * 店の表を並べる運営の一覧は SCAN で正しいので見ない。公開中だけの部分索引を端から読む `SCAN o USING INDEX …` は
 * 索引を使っているので通す。
 */
const TABLES = /^(SCAN|SEARCH) (reservations|res|cr|r|n|ar|pr|prev|fetch_items|fi|fetch_logs|fl|offers|o|ao)\b/;
const isWideRead = (detail: string): boolean => TABLES.test(detail) && !/\bUSING\b/.test(detail);

describe("読み取りの幅と索引（設計-08）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  const plan = async (recorded: Recorded): Promise<string[]> =>
    ((await ctx.db.prepare(`EXPLAIN QUERY PLAN ${recorded.sql}`).bind(...recorded.params).all()).results as any[]).map((row) => String(row.detail));

  const wideScansOf = async (run: (db: Db) => Promise<unknown>): Promise<string[]> => {
    const statements = await recordStatements(run);
    expect(statements.length).toBeGreaterThan(0);
    const details = (await Promise.all(statements.map(plan))).flat();
    return details.filter(isWideRead);
  };

  const NOW = "2026-09-22T06:00:00.000Z";
  const SINCE = "2026-09-21T06:00:00.000Z";

  it("店のホームの一覧と期限切れの記録の足し込みは、その店の確保を索引で引く（全店・全期間を読まない）", async () => {
    expect(await wideScansOf((db) => listStoreArrivals(db, "store-x", SINCE))).toEqual([]);
    expect(await wideScansOf((db) => insertExpiredEvents(db, { kind: "store", id: "store-x", sinceIso: SINCE }, NOW))).toEqual([]);
    expect(await wideScansOf((db) => insertExpiredEvents(db, { kind: "customer", id: "customer-x" }, NOW))).toEqual([]);
  });

  it("店の実績は、その店の確保と、その店が出た取得の記録だけを索引で引く", async () => {
    expect(await wideScansOf((db) => listReservationStatesOfStore(db, "store-x"))).toEqual([]);
    expect(await wideScansOf((db) => listOfferShownCounts(db, "store-x"))).toEqual([]);
  });

  it("運営の一覧の受け取り実績と公開中の残りは、店ごとに索引で引く（店の数 × 全部の確保を読まない）", async () => {
    expect(await wideScansOf((db) => listStoresForAdmin(db, { nowIso: NOW }))).toEqual([]);
  });

  it("客の最後の取得の時刻は、その客の記録を索引で引く", async () => {
    expect(await wideScansOf((db) => findLastFetchAt(db, "customer-x"))).toEqual([]);
  });

  it("取得の候補は、公開中のオファーの部分索引と起点の周りの四角形で読む", async () => {
    expect(await wideScansOf((db) => findFetchCandidates(db, NOW, searchBounds(SHIBUYA)))).toEqual([]);
  });

  it("取得の候補の四角形の外の店（探す範囲の外）は、D1 から読まない。範囲の内の店は読む", async () => {
    const far = await approvedStore(ctx, { name: "遠い店", lat: SHIBUYA.lat + 0.5, lng: SHIBUYA.lng });
    await publishOffer(far.api);
    const near = await approvedStore(ctx, { name: "近い店", ...north(SHIBUYA, SEARCH_RADIUS_METERS - 1) });
    await publishOffer(near.api);
    const ids = (await findFetchCandidates(ctx.db, ctx.clock.now().toISOString(), searchBounds(SHIBUYA))).map((row) => row.storeId);
    expect(ids).toContain(near.id);
    expect(ids).not.toContain(far.id);
  });
});

describe("探す範囲の四角形（設計-08）", () => {
  /** 起点から方位 bearing（度）へ meters 進んだ点（球面の式） */
  const destination = (origin: { lat: number; lng: number }, meters: number, bearing: number) => {
    const R = 6_371_000;
    const rad = (d: number) => (d * Math.PI) / 180;
    const deg = (r: number) => (r * 180) / Math.PI;
    const angular = meters / R;
    const theta = rad(bearing);
    const phi1 = rad(origin.lat);
    const lambda1 = rad(origin.lng);
    const phi2 = Math.asin(Math.sin(phi1) * Math.cos(angular) + Math.cos(phi1) * Math.sin(angular) * Math.cos(theta));
    const lambda2 = lambda1 + Math.atan2(Math.sin(theta) * Math.sin(angular) * Math.cos(phi1), Math.cos(angular) - Math.sin(phi1) * Math.sin(phi2));
    return { lat: deg(phi2), lng: deg(lambda2) };
  };

  it("起点から800m のどの方位の点も四角形の内に入る（範囲の円を必ず含む）。日本の北端と南端でも", () => {
    for (const origin of [SHIBUYA, { lat: 45.5, lng: 141.9 }, { lat: 24.3, lng: 123.8 }]) {
      const box = searchBounds(origin);
      for (let bearing = 0; bearing < 360; bearing += 5) {
        const p = destination(origin, SEARCH_RADIUS_METERS, bearing);
        expect(distanceMeters(origin, p)).toBeCloseTo(SEARCH_RADIUS_METERS, 3);
        expect(p.lat, `${bearing}°`).toBeGreaterThanOrEqual(box.latMin);
        expect(p.lat, `${bearing}°`).toBeLessThanOrEqual(box.latMax);
        expect(p.lng, `${bearing}°`).toBeGreaterThanOrEqual(box.lngMin);
        expect(p.lng, `${bearing}°`).toBeLessThanOrEqual(box.lngMax);
      }
    }
  });

  it("四角形は円より広すぎない（1km 先の東西南北は外）", () => {
    const box = searchBounds(SHIBUYA);
    for (const bearing of [0, 90, 180, 270]) {
      const p = destination(SHIBUYA, 1000, bearing);
      const inside = p.lat >= box.latMin && p.lat <= box.latMax && p.lng >= box.lngMin && p.lng <= box.lngMax;
      expect(inside, `${bearing}°`).toBe(false);
    }
  });
});

describe("店のホームは店の行とクーポンを1回ずつ読む（設計-10 の②）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("GET /api/store/home 1回で、クーポンの表と店の行を読む文はそれぞれ1回", async () => {
    const s = await receivedScene(ctx, { coupons: [{ name: "一杯目半額", note: "" }] });
    const prepared: string[] = [];
    const db = interleaved(ctx.db, []);
    const counting: Db = { ...db, prepare: (sql: string) => (prepared.push(sql), db.prepare(sql)) };
    const { createApp } = await import("../lib/http/app");
    const app = createApp({ ...ctx.deps, db: counting } as any);
    const res = await app.fetch(new Request("https://app.test/api/store/home", { headers: { cookie: s.store.api.cookie ?? "", origin: "https://app.test" } }));
    expect(res.status).toBe(200);
    const home = (await res.json()) as any;
    expect(home.coupons).toHaveLength(1);
    expect(home.offer.coupons).toEqual([{ id: home.coupons[0].id, name: "一杯目半額", note: "" }]);
    expect(prepared.filter((sql) => /\bFROM coupons\b/.test(sql) && !/FROM offers/.test(sql))).toHaveLength(1);
    expect(prepared.filter((sql) => /\bFROM stores WHERE id = \?1/.test(sql))).toHaveLength(1);
  });
});
