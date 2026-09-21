// 店の実績（要件23の基準 23.1〜23.8）。
//
// ⚠️ なぜ受け入れ検査とは別にこれを置くか: 受け入れ検査 `r23-results.test.ts` は場面の準備に
// 完了済み（タスク17）・客の取り消し（15）・店の取り消し（18）・運営の停止（21）の入口を使うので、
// **それらが揃うまで1件も回せない**（2026-09-21 の並列の実装で、どれも別の実装者が同時に書いている）。
// ここでは D1 に直に種を入れて、タスク22 の持ち場だけを先に確かめる。受け入れ検査が通るように
// なったら、重なる分はここから落としてよい。この置き方の前例はタスク8の `adminStores.test.ts` と
// タスク24の `adminMetrics.test.ts`（同じ理由・同じ形）。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeCtx, registerStore, rows, T0, type Api, type Ctx } from "../../../tests/acceptance/v2/_fakes";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const at = (offsetMs: number) => new Date(new Date(T0).getTime() + offsetMs).toISOString();

/** 記録の5つの表（基準 27.7。実績を読んでも1行も変わらないことを見る）。 */
const LOG_TABLES = ["fetch_logs", "fetch_items", "selections", "reservation_events", "ai_calls"];

const CUSTOMER_ID = "customer-results";
/** 止めたオファー（公開 T0・T0+25分に止めた） */
const OFFER_STOPPED = "offer-results-stopped";
/** 公開中のオファー（公開 T0+30分） */
const OFFER_LIVE = "offer-results-live";
/**
 * 取得が返ったのと**同じ時刻**に終わったオファー（公開 T0+60分・終わり T0+60分）。
 * 運営が店を止めるとその場でオファーも終わるので、この並びは実際に起きる（2026-09-21 の実装で
 * `ended_at` の境界を `<` にしていて、この取得を落としていた）。
 */
const OFFER_SAME_INSTANT = "offer-results-same-instant";

let ctx: Ctx;
let store: Api;
let storeId: string;
/** 実績が1件も無い別の店（混ざらないことを見る） */
let otherStore: Api;
let otherStoreId: string;

const seedOffer = (id: string, input: { publishedAt: string; untilAt: string; endedAt: string | null }) =>
  ctx.db
    .prepare(
      `INSERT INTO offers (id, store_id, capacity, initial_capacity, party_max, published_at, until_at, ended_at, end_reason)
       VALUES (?1, ?2, 10, 10, 4, ?3, ?4, ?5, ?6)`,
    )
    .bind(id, storeId, input.publishedAt, input.untilAt, input.endedAt, input.endedAt === null ? null : "stopped")
    .run();

/** 取得1回の記録（タスク11 が入口から入れる列を直に埋める）。 */
const seedFetch = (id: string, atIso: string) =>
  ctx.db
    .prepare(
      `INSERT INTO fetch_logs (id, customer_id, origin_lat, origin_lng, party, genres, budget_max, candidate_count, returned_count, ai_used, duration_ms, at)
       VALUES (?1, ?2, 35.6595, 139.7005, 2, '[]', NULL, 1, 1, 1, 1200, ?3)`,
    )
    .bind(id, CUSTOMER_ID, atIso)
    .run();

/** 「その取得でこの店が客に返った」1行（基準 23.2 の元）。 */
const seedFetchItem = (id: string, input: { fetchId: string; storeId: string }) =>
  ctx.db
    .prepare(`INSERT INTO fetch_items (id, fetch_id, store_id, rank, score, reason) VALUES (?1, ?2, ?3, 1, 80.0, '近くて好みに合います')`)
    .bind(id, input.fetchId, input.storeId)
    .run();

/** 確保1件（タスク13 が入口から入れ、15・17・18・21 が status を変える列を直に埋める）。コードは重ならない値（基準 8.3）。 */
let codeSeq = 70000000;
const seedReservation = (id: string, input: { offerId: string; status: string; createdAt: string; completedAfterExpiry?: 0 | 1 }) =>
  ctx.db
    .prepare(
      `INSERT INTO reservations (id, offer_id, store_id, customer_id, fetch_id, party, code, created_at, expires_at, status, status_at, holds_slot, completed_after_expiry, coupons_json)
       VALUES (?1, ?2, ?3, ?4, 'fetch-1', 2, ?5, ?6, ?7, ?8, ?6, 1, ?9, '[]')`,
    )
    .bind(
      id,
      input.offerId,
      storeId,
      CUSTOMER_ID,
      String(++codeSeq),
      input.createdAt,
      new Date(new Date(input.createdAt).getTime() + 20 * MINUTE).toISOString(),
      input.status,
      input.completedAfterExpiry ?? 0,
    )
    .run();

beforeAll(async () => {
  ctx = await makeCtx();
  const registered = await registerStore(ctx, { name: "実績の店" });
  store = registered.api;
  storeId = registered.id;
  const other = await registerStore(ctx, { name: "実績なしの店" });
  otherStore = other.api;
  otherStoreId = other.id;
  await ctx.db
    .prepare(`INSERT INTO customers (id, nickname, phone, genres, budget_max, token_hash) VALUES (?1, ?2, ?3, '[]', NULL, ?4)`)
    .bind(CUSTOMER_ID, "じっせきの客", "08099991111", "token-hash-results")
    .run();

  // オファー3つ: 公開 T0 で T0+25分に止めたもの・公開 T0+30分でまだ公開中のもの・
  // 公開と同じ T0+60分に終わったもの（取得と終わりが同じ時刻に並ぶ場合）。
  await seedOffer(OFFER_STOPPED, { publishedAt: T0, untilAt: at(8 * HOUR), endedAt: at(25 * MINUTE) });
  await seedOffer(OFFER_LIVE, { publishedAt: at(30 * MINUTE), untilAt: at(8 * HOUR), endedAt: null });
  await seedOffer(OFFER_SAME_INSTANT, { publishedAt: at(60 * MINUTE), untilAt: at(8 * HOUR), endedAt: at(60 * MINUTE) });

  // 取得10回。止めたオファーの間（T0）に6回この店が返り、1回は返らず（遠い客）、
  // 1回は別の店だけが返った。公開中のオファーの間（T0+30分）に1回、最後のオファーの
  // 公開と同じ時刻（T0+60分）に1回この店が返った。
  for (let i = 1; i <= 6; i++) {
    await seedFetch(`fetch-shown-${i}`, T0);
    await seedFetchItem(`item-shown-${i}`, { fetchId: `fetch-shown-${i}`, storeId });
  }
  await seedFetch("fetch-far", T0);
  await seedFetch("fetch-other-store", T0);
  await seedFetchItem("item-other-store", { fetchId: "fetch-other-store", storeId: otherStoreId });
  await seedFetch("fetch-live", at(30 * MINUTE));
  await seedFetchItem("item-live", { fetchId: "fetch-live", storeId });
  await seedFetch("fetch-same-instant", at(60 * MINUTE));
  await seedFetchItem("item-same-instant", { fetchId: "fetch-same-instant", storeId });

  // 止めたオファーの確保5件: 完了済み・客が取り消し・店が取り消し・期限切れのあとの完了済み・手つかず。
  await seedReservation("res-completed", { offerId: OFFER_STOPPED, status: "completed", createdAt: T0 });
  await seedReservation("res-customer-cancelled", { offerId: OFFER_STOPPED, status: "customer_cancelled", createdAt: T0 });
  await seedReservation("res-store-cancelled", { offerId: OFFER_STOPPED, status: "store_cancelled", createdAt: T0 });
  await seedReservation("res-completed-after-expiry", { offerId: OFFER_STOPPED, status: "completed", createdAt: T0, completedAfterExpiry: 1 });
  await seedReservation("res-untouched", { offerId: OFFER_STOPPED, status: "active", createdAt: T0 });
  // 公開中のオファーの確保1件: 運営が店を止めて取り消された。
  await seedReservation("res-admin-cancelled", { offerId: OFFER_LIVE, status: "admin_cancelled", createdAt: at(30 * MINUTE) });
});

afterAll(async () => {
  await ctx.dispose();
});

/** 応答の1行（設計書「入口の一覧」の応答の形。検査の側でも形を固定して読む）。 */
type CancelledDto = { total: number; customer: number; expired: number; store: number; admin: number };
type ResultItemDto = { offerId: string; publishedAt: string; shown: number; received: number; completed: number; cancelled: CancelledDto };

const resultsOf = async (api: Api): Promise<ResultItemDto[]> => {
  const r = await api.get("/api/store/results");
  expect(r.status).toBe(200);
  return r.json.items as ResultItemDto[];
};

const offerOf = (items: readonly ResultItemDto[], offerId: string): ResultItemDto => {
  const found = items.find((item) => item.offerId === offerId);
  if (!found) throw new Error(`実績にオファー ${offerId} の行がありません`);
  return found;
};

describe("店の実績（要件23）", () => {
  it("23.1〜23.6 オファーごとに、出た回数・受け取られた数・完了済み・取り消し（内訳つき）を数える", async () => {
    ctx.clock.set(at(70 * MINUTE));
    const items = await resultsOf(store);
    expect(offerOf(items, OFFER_STOPPED)).toMatchObject({
      shown: 6,
      received: 5,
      completed: 2,
      cancelled: { total: 3, customer: 1, expired: 1, store: 1, admin: 0 },
    });
    expect(offerOf(items, OFFER_LIVE)).toMatchObject({
      shown: 1,
      received: 1,
      completed: 0,
      cancelled: { total: 1, customer: 0, expired: 0, store: 0, admin: 1 },
    });
  });

  it("23.2 出た回数は、そのオファーが公開していた間に、この店が返った取得の回数（返らなかった取得と別の店の取得は数えない）", async () => {
    // 種は取得10回。この店が返ったのは8回で、6回・1回・1回の3つのオファーに分かれる。
    // 返らなかった取得（遠い客）と、別の店だけが返った取得は、どのオファーにも入らない。
    ctx.clock.set(at(70 * MINUTE));
    const items = await resultsOf(store);
    expect(items.map((item) => item.shown)).toEqual([1, 1, 6]);
    expect(items.reduce((sum, item) => sum + item.shown, 0)).toBe(8);
    expect((await rows(ctx.db, `SELECT id FROM fetch_logs`)).length).toBe(10);
  });

  it("23.2 終わりと同じ時刻に返った取得も数える（1回の取得が2つのオファーに二重に入らない）", async () => {
    ctx.clock.set(at(70 * MINUTE));
    const items = await resultsOf(store);
    // 公開と終わりが同じ T0+60分のオファーは、その時刻の取得を1回として数える。
    expect(offerOf(items, OFFER_SAME_INSTANT).shown).toBe(1);
    // 同じ取得は、まだ終わっていない1つ前のオファー（公開 T0+30分・終わり無し）には入らない。
    expect(offerOf(items, OFFER_LIVE).shown).toBe(1);
  });

  it("23.4・23.5 期限切れのあとに店が完了済みにした確保は完了済みに入り、取り消しには入らない", async () => {
    ctx.clock.set(at(70 * MINUTE));
    const stopped = offerOf(await resultsOf(store), OFFER_STOPPED);
    expect(stopped.completed).toBe(2);
    expect(stopped.cancelled.expired).toBe(1);
  });

  it("期限切れは列に持たず時刻から導く: 期限より前に読むと、手つかずの確保はまだ取り消しに入らない", async () => {
    ctx.clock.set(at(10 * MINUTE));
    const stopped = offerOf(await resultsOf(store), OFFER_STOPPED);
    expect(stopped.completed).toBe(2);
    expect(stopped.cancelled).toEqual({ total: 2, customer: 1, expired: 0, store: 1, admin: 0 });
    ctx.clock.set(at(70 * MINUTE));
  });

  it("23.7 終わったオファーも出て、並びは公開した時刻の新しい順", async () => {
    const items = await resultsOf(store);
    expect(items.map((item) => item.offerId)).toEqual([OFFER_SAME_INSTANT, OFFER_LIVE, OFFER_STOPPED]);
    expect(items[2].publishedAt).toBe(T0);
  });

  it("23.8 オファーが1つも無い店は0件。別の店の実績は混ざらない", async () => {
    expect(await resultsOf(otherStore)).toEqual([]);
  });

  it("2.5 店の番号を要求で送っても、他店の実績は返らない（見るのはセッションの店だけ）", async () => {
    const r = await otherStore.get(`/api/store/results?storeId=${storeId}`);
    expect(r.json.items).toEqual([]);
  });

  it("27.7 実績を読んでも、記録の5つの表は1行も変わらない", async () => {
    const before: Record<string, unknown[]> = {};
    for (const table of LOG_TABLES) before[table] = await rows(ctx.db, `SELECT * FROM "${table}" ORDER BY rowid`);
    await store.get("/api/store/results");
    for (const table of LOG_TABLES) {
      expect(await rows(ctx.db, `SELECT * FROM "${table}" ORDER BY rowid`), table).toEqual(before[table]);
    }
  });
});
