// 過去の受け取りの見返し（要件8の基準 8.11【最終日】）。
//
// ⚠️ なぜ受け入れ検査とは別にこれを置くか: 受け入れ検査 `r08-receive.test.ts` のタスク30 の
// ブロックは、場面の準備に**客の取り消し**（`POST /api/customer/reservations/:id/cancel`・タスク15）を
// 使う。その入口がまだ無いので、取り消しが通らず→確保中のまま→2件目の受け取りが 409 になり、
// 一覧に2件並ぶ場面そのものが作れない（2026-09-21 の並列の実装。タスク15 は別の実装者が同時に書いている）。
// ここでは D1 に直に種を入れて、タスク30 の持ち場だけを先に確かめる。タスク15 が入ったら、
// 重なる分はここから落としてよい。前例はタスク8の `adminStores.test.ts`・タスク24の `adminMetrics.test.ts`。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeCtx, one, registerCustomer, registerStore, T0, type Api, type Ctx } from "../../../tests/acceptance/v2/_fakes";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const at = (offsetMs: number) => new Date(new Date(T0).getTime() + offsetMs).toISOString();

let ctx: Ctx;
/** 見返す客 */
let customer: Api;
let customerId: string;
/** 別の客（その受け取りが1件も混ざらないことを見る） */
let otherCustomer: Api;
let otherCustomerId: string;
let firstStoreId: string;
let secondStoreId: string;

const customerIdOf = async (phone: string): Promise<string> => {
  const row = await one<{ id: string }>(ctx.db, `SELECT id FROM customers WHERE phone = ?1`, phone);
  if (!row) throw new Error(`客が見つかりません: ${phone}`);
  return row.id;
};

const seedStoreProfile = (id: string, input: { address: string; url: string | null }) =>
  ctx.db.prepare(`UPDATE stores SET address = ?2, url = ?3, status = 'approved' WHERE id = ?1`).bind(id, input.address, input.url).run();

const seedOffer = (id: string, storeId: string) =>
  ctx.db
    .prepare(
      `INSERT INTO offers (id, store_id, capacity, initial_capacity, party_max, published_at, until_at) VALUES (?1, ?2, 3, 3, 4, ?3, ?4)`,
    )
    .bind(id, storeId, T0, at(8 * HOUR))
    .run();

/** 確保1件（タスク13 が入口から入れ、15・17・18・21 が status を変える列を直に埋める）。 */
const seedReservation = (
  id: string,
  input: { offerId: string; storeId: string; customerId: string; code: string; status: string; createdAt: string },
) =>
  ctx.db
    .prepare(
      `INSERT INTO reservations (id, offer_id, store_id, customer_id, fetch_id, party, code, created_at, expires_at, status, status_at, holds_slot, completed_after_expiry, coupons_json)
       VALUES (?1, ?2, ?3, ?4, 'fetch-1', 2, ?5, ?6, ?7, ?8, ?6, 1, 0, '[]')`,
    )
    .bind(
      id,
      input.offerId,
      input.storeId,
      input.customerId,
      input.code,
      input.createdAt,
      new Date(new Date(input.createdAt).getTime() + 20 * MINUTE).toISOString(),
      input.status,
    )
    .run();

beforeAll(async () => {
  ctx = await makeCtx();
  const registered = await registerCustomer(ctx, { nickname: "みかえす客", phone: "08077770001" });
  customer = registered.api;
  customerId = await customerIdOf("08077770001");
  const other = await registerCustomer(ctx, { nickname: "べつの客", phone: "08077770002" });
  otherCustomer = other.api;
  otherCustomerId = await customerIdOf("08077770002");

  firstStoreId = (await registerStore(ctx, { name: "一軒目" })).id;
  secondStoreId = (await registerStore(ctx, { name: "二軒目" })).id;
  await seedStoreProfile(firstStoreId, { address: "一軒目の住所", url: "https://example.com/first" });
  await seedStoreProfile(secondStoreId, { address: "二軒目の住所", url: null });
  await seedOffer("offer-first", firstStoreId);
  await seedOffer("offer-second", secondStoreId);

  // 一軒目を受け取って取り消し（T0）→ 二軒目を受け取って今も確保中（T0+1分）。
  await seedReservation("res-first", {
    offerId: "offer-first",
    storeId: firstStoreId,
    customerId,
    code: "11110001",
    status: "customer_cancelled",
    createdAt: T0,
  });
  await seedReservation("res-second", {
    offerId: "offer-second",
    storeId: secondStoreId,
    customerId,
    code: "11110002",
    status: "active",
    createdAt: at(MINUTE),
  });
  // 別の客の受け取り（同じ一軒目）。
  await seedReservation("res-other", {
    offerId: "offer-first",
    storeId: firstStoreId,
    customerId: otherCustomerId,
    code: "99990003",
    status: "active",
    createdAt: at(MINUTE),
  });
});

afterAll(async () => {
  await ctx.dispose();
});

/** 応答の1行（基準 8.11 の5つ）。検査の側でも形を固定して読む。 */
type HistoryItemDto = { id: string; code: string; status: string; storeName: string; storeAddress: string; storeUrl: string | null };

const historyOf = async (api: Api): Promise<HistoryItemDto[]> => {
  const r = await api.get("/api/customer/history");
  expect(r.status).toBe(200);
  return r.json.items as HistoryItemDto[];
};

describe("過去の受け取りの見返し（要件8の基準 8.11）", () => {
  it("8.11 店名・コード・状態・住所・URL が新しい順に出る", async () => {
    ctx.clock.set(at(5 * MINUTE));
    const r = await customer.get("/api/customer/history");
    expect(r.status).toBe(200);
    expect((r.json.items as HistoryItemDto[]).map((item) => item.storeName)).toEqual(["二軒目", "一軒目"]);
    expect(r.json.items[0]).toMatchObject({ code: "11110002", status: "active", storeAddress: "二軒目の住所", storeUrl: null });
    expect(r.json.items[1]).toMatchObject({ code: "11110001", status: "customer_cancelled", storeAddress: "一軒目の住所", storeUrl: "https://example.com/first" });
  });

  it("2.5 別の客の受け取りは1件も混ざらない（コードも本文に出ない）", async () => {
    ctx.clock.set(at(5 * MINUTE));
    const r = await customer.get("/api/customer/history");
    expect(r.json.items).toHaveLength(2);
    expect(r.text).not.toContain("99990003");
  });

  it("確保の状態は時刻から導く: 期限を過ぎると確保中が期限切れになる（列は変わらない）", async () => {
    ctx.clock.set(at(30 * MINUTE));
    const r = await customer.get("/api/customer/history");
    expect(r.json.items[0]).toMatchObject({ code: "11110002", status: "expired" });
    expect(r.json.items[1].status).toBe("customer_cancelled");
    const stored = await one<{ status: string }>(ctx.db, `SELECT status FROM reservations WHERE id = 'res-second'`);
    expect(stored?.status).toBe("active");
    ctx.clock.set(at(5 * MINUTE));
  });

  it("1件も受け取っていない客は0件（画面が「まだありません」を出す元）", async () => {
    const fresh = await registerCustomer(ctx, { nickname: "はじめての客", phone: "08077770009" });
    expect(await historyOf(fresh.api)).toEqual([]);
  });

  it("見分けの無い要求は 401（客の識別子が要る）", async () => {
    const r = await ctx.api().get("/api/customer/history");
    expect(r.status).toBe(401);
    expect(r.json.items).toBeUndefined();
  });

  it("別の客の番号を送っても、自分の受け取りしか返らない", async () => {
    const r = await otherCustomer.get(`/api/customer/history?customerId=${customerId}`);
    expect((r.json.items as HistoryItemDto[]).map((item) => item.code)).toEqual(["99990003"]);
  });
});
