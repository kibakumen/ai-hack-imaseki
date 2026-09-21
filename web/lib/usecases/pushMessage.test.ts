// 客への知らせ（要件22の基準 22.1・22.2・22.4〜22.8・22.11）の手続きと入口2本。
//
// ⚠️ なぜ受け入れ検査とは別にこれを置くか: 受け入れ検査 `r22-push.test.ts` は場面の準備に
// 受け取り（タスク13）・完了済み（17）・店の取り消し（18）・運営の停止（21）の入口を使うので、
// それらが揃うまで1件も回せない。ここでは確保の行を D1 に直に入れて、タスク19の持ち場だけを先に
// 確かめる。受け入れ検査が通るようになったら、重なる分はここから落としてよい（2026-09-21 実行者）。
// この置き方の前例はタスク8の `adminStores.test.ts`・タスク24の `adminMetrics.test.ts`（同じ理由・同じ形）。
//
// 送る側（タスク18・21）が繋いだあとも、ここが見るのは「口の振る舞い」なので残す。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeCtx, one, registerCustomer, rows, T0, type Ctx } from "../../../tests/acceptance/v2/_fakes";
import { pushMessage, pushPromptDue, sendCancellationPush, sendCancellationPushes } from "./pushMessage";

const SUBSCRIPTION = { endpoint: "https://push.example.test/sub/1", keys: { p256dh: "BPUB", auth: "AUTH" } };
const STORE_ID = "store-push";
const OFFER_ID = "offer-push";

let ctx: Ctx;
let seq = 0;

/** 客を1人（入口で登録して、確保の行から指せるように内部の番号も取る）。 */
const newCustomer = async (nickname: string) => {
  const phone = `080999900${String(++seq).padStart(2, "0")}`;
  const customer = await registerCustomer(ctx, { nickname, phone });
  const row = await one<{ id: string }>(ctx.db, `SELECT id FROM customers WHERE nickname = ?1`, nickname);
  return { ...customer, id: row!.id };
};

/** 確保を1件（タスク13・18・21 が入口から入れる列を直に埋める）。 */
const seedReservation = async (customerId: string, status: string) => {
  const id = `res-${++seq}`;
  await ctx.db
    .prepare(
      `INSERT INTO reservations (id, offer_id, store_id, customer_id, fetch_id, party, code, created_at, expires_at, status, status_at, holds_slot, completed_after_expiry, coupons_json)
       VALUES (?1, ?2, ?3, ?4, 'fetch-push', 2, ?5, ?6, ?6, ?7, ?6, 1, 0, '[]')`,
    )
    .bind(id, OFFER_ID, STORE_ID, customerId, String(10_000_000 + seq), new Date(new Date(T0).getTime() + seq * 1000).toISOString(), status)
    .run();
  return id;
};

const subscriptionRows = (customerId: string) => rows(ctx.db, `SELECT subscription_json FROM push_subscriptions WHERE customer_id = ?1`, customerId);

beforeAll(async () => {
  ctx = await makeCtx();
  await ctx.db.prepare(`INSERT INTO stores (id, name, status) VALUES (?1, '知らせの店', 'approved')`).bind(STORE_ID).run();
  await ctx.db
    .prepare(`INSERT INTO offers (id, store_id, capacity, initial_capacity, party_max, published_at, until_at) VALUES (?1, ?2, 3, 3, 4, ?3, ?3)`)
    .bind(OFFER_ID, STORE_ID, T0)
    .run();
});
afterAll(async () => {
  await ctx.dispose();
});

describe("通知の購読の入口（POST /api/customer/push-subscription）", () => {
  it("購読を預かる。同じ客が送り直したら入れ替わる（客1人に1つ）", async () => {
    const customer = await newCustomer("こうどく");
    expect((await customer.api.post("/api/customer/push-subscription", { subscription: SUBSCRIPTION })).status).toBe(200);
    expect(await subscriptionRows(customer.id)).toHaveLength(1);
    const next = { ...SUBSCRIPTION, endpoint: "https://push.example.test/sub/2" };
    expect((await customer.api.post("/api/customer/push-subscription", { subscription: next })).status).toBe(200);
    const saved = await subscriptionRows(customer.id);
    expect(saved).toHaveLength(1);
    expect(JSON.parse(saved[0].subscription_json as string)).toEqual(next);
  });

  it("同じ端末が別の客として送ってきたら、前の客の購読は消える（端末1台＝客1人）", async () => {
    const first = await newCustomer("まえのきゃく");
    const second = await newCustomer("あとのきゃく");
    const device = { ...SUBSCRIPTION, endpoint: "https://push.example.test/sub/shared" };
    await first.api.post("/api/customer/push-subscription", { subscription: device });
    await second.api.post("/api/customer/push-subscription", { subscription: device });
    expect(await subscriptionRows(first.id)).toHaveLength(0);
    expect(await subscriptionRows(second.id)).toHaveLength(1);
  });

  it("見分けの無い要求は断る（401）。壊れた入力は入力の断り（400）", async () => {
    expect((await ctx.api().post("/api/customer/push-subscription", { subscription: SUBSCRIPTION })).status).toBe(401);
    const customer = await newCustomer("こわれた");
    const broken = await customer.api.post("/api/customer/push-subscription", { subscription: "x" });
    expect(broken.status).toBe(400);
    expect(broken.json.error.kind).toBe("invalid_input");
    expect(broken.json.error.fields[0].name).toBe("subscription");
    expect((await customer.api.post("/api/customer/push-subscription", {})).status).toBe(400);
    expect((await customer.api.post("/api/customer/push-subscription", { subscription: { endpoint: "http://push.example.test/x", keys: { p256dh: "a", auth: "b" } } })).status).toBe(400);
    expect(await subscriptionRows(customer.id)).toHaveLength(0);
  });
});

describe("取り消しの知らせ（usecases/pushMessage の送信の口）", () => {
  it("22.1 購読のある客へ1回だけ送る。渡すのは預かった購読と TTL 20分で、客のデータは渡らない", async () => {
    const customer = await newCustomer("おくる");
    await customer.api.post("/api/customer/push-subscription", { subscription: SUBSCRIPTION });
    const before = ctx.push.calls.length;
    await sendCancellationPush(ctx.deps, customer.id);
    expect(ctx.push.calls).toHaveLength(before + 1);
    const call = ctx.push.calls.at(-1)!;
    expect(call.subscription).toEqual(SUBSCRIPTION);
    expect(call.ttlSeconds).toBe(20 * 60);
    expect(JSON.stringify(call)).not.toMatch(/おくる|0809999|payload|body/);
  });

  it("22.7 通知を許可していない客には、送信を試みない", async () => {
    const customer = await newCustomer("みこうどく");
    const before = ctx.push.calls.length;
    await sendCancellationPush(ctx.deps, customer.id);
    expect(ctx.push.calls).toHaveLength(before);
  });

  it("22.6 配信元が落ちても投げ返さない。「もう無い」と答えた購読は消える", async () => {
    const thrown = await newCustomer("れいがい");
    await thrown.api.post("/api/customer/push-subscription", { subscription: SUBSCRIPTION });
    ctx.push.result = "throw";
    await expect(sendCancellationPush(ctx.deps, thrown.id)).resolves.toBeUndefined();
    // 例外の購読は消さない（次の取り消しでもう一度試せる）。
    expect(await subscriptionRows(thrown.id)).toHaveLength(1);

    const gone = await newCustomer("もうない");
    await gone.api.post("/api/customer/push-subscription", { subscription: SUBSCRIPTION });
    ctx.push.result = { ok: false, gone: true };
    await sendCancellationPush(ctx.deps, gone.id);
    expect(await subscriptionRows(gone.id)).toHaveLength(0);

    const failed = await newCustomer("しっぱい");
    await failed.api.post("/api/customer/push-subscription", { subscription: SUBSCRIPTION });
    ctx.push.result = { ok: false, gone: false };
    await sendCancellationPush(ctx.deps, failed.id);
    expect(await subscriptionRows(failed.id)).toHaveLength(1);
    ctx.push.result = { ok: true };
  });

  it("22.2 何人かへ1回ずつ送る（購読の無い客は飛ばす）", async () => {
    const a = await newCustomer("ふたりめA");
    const b = await newCustomer("ふたりめB");
    const c = await newCustomer("ふたりめC");
    // ⚠️ 客ごとに**別の端末**にする（同じ `endpoint` を2人が持つと、後から送った側だけが残る
    // ——端末1台＝客1人。`repo/push.savePushSubscription` の注）。
    for (const customer of [a, c]) await customer.api.post("/api/customer/push-subscription", { subscription: { ...SUBSCRIPTION, endpoint: `${SUBSCRIPTION.endpoint}/${customer.id}` } });
    const before = ctx.push.calls.length;
    await sendCancellationPushes(ctx.deps, [a.id, b.id, c.id]);
    expect(ctx.push.calls).toHaveLength(before + 2);
  });
});

describe("文面の入口（GET /api/customer/push-message）", () => {
  it("22.4・22.5 場面ごとの決まった文。呼び名も電話番号も応答に無い", async () => {
    const customer = await newCustomer("ぶんめん");
    await seedReservation(customer.id, "store_cancelled");
    const store = await customer.api.get("/api/customer/push-message");
    expect(store.status).toBe(200);
    expect(store.json.scene).toBe("store_cancelled");
    expect(store.json.title.length).toBeGreaterThan(0);
    expect(store.json.body.length).toBeGreaterThan(0);
    expect(Object.keys(store.json).sort()).toEqual(["body", "scene", "title"]);
    expect(store.text).not.toContain("ぶんめん");
    expect(store.text).not.toContain(customer.id);

    const admin = await newCustomer("うんえい");
    await seedReservation(admin.id, "admin_cancelled");
    const adminMessage = await admin.api.get("/api/customer/push-message");
    expect(adminMessage.json.scene).toBe("admin_cancelled");
    expect(adminMessage.json.body).not.toBe(store.json.body);
  });

  it("22.3 取り消し以外の状態と、確保が1件も無い客は場面なし。新しい確保を受け取り直した客にも古い文面を返さない", async () => {
    const none = await newCustomer("かくほなし");
    expect((await none.api.get("/api/customer/push-message")).json).toEqual({ scene: null, title: null, body: null });
    for (const status of ["active", "completed", "expired", "customer_cancelled"]) {
      const customer = await newCustomer(`じょうたい${seq}`);
      await seedReservation(customer.id, status);
      expect((await customer.api.get("/api/customer/push-message")).json.scene, status).toBeNull();
    }
    const retried = await newCustomer("とりなおし");
    await seedReservation(retried.id, "store_cancelled");
    await seedReservation(retried.id, "active");
    expect((await retried.api.get("/api/customer/push-message")).json.scene).toBeNull();
  });

  it("手続きは入口を通さなくても同じ答えを返す（呼ぶのは場面の名前だけ）", async () => {
    const customer = await newCustomer("てつづき");
    await seedReservation(customer.id, "store_cancelled");
    expect(await pushMessage(ctx.deps, customer.id)).toEqual((await customer.api.get("/api/customer/push-message")).json);
  });
});

describe("通知の許可を求めるか（22.8・22.11 の入口の側）", () => {
  it("まだ許可していない客は true、許可した客は false", async () => {
    const customer = await newCustomer("きょかまえ");
    expect(await pushPromptDue(ctx.deps, customer.id)).toBe(true);
    await customer.api.post("/api/customer/push-subscription", { subscription: SUBSCRIPTION });
    expect(await pushPromptDue(ctx.deps, customer.id)).toBe(false);
  });
});
