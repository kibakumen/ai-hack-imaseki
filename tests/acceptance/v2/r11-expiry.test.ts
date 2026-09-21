// 要件11 確保の期限と自動の取り消し（手続き）。画面は r11-expiry.ui.test.tsx。
// 後のタスクの操作（完了済み17・公開中の変更20）が要る場合は、そのタスクの番号を名乗る。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { approvedStore, fetchOffers, makeCtx, MIN, one, publishOffer, receive, receivedScene, registerCustomer, type Ctx } from "./_fakes";

const at = (ctx: Ctx, minutesFromT0: number) => ctx.clock.set(new Date(new Date("2026-09-22T06:00:00.000Z").getTime() + minutesFromT0 * MIN).toISOString());
const read = (ctx: Ctx, id: string) => one(ctx.db, "SELECT status, expires_at, party, code FROM reservations WHERE id = ?", id);

describeTask("16", "期限切れと受け取り直し", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("11.1・11.2 誰も読まないまま20分進めると、別の客がその枠を受け取れる（書き込みは起きていない）", async () => {
    at(ctx, 0);
    const s = await receivedScene(ctx, { capacity: 1 });
    const rowBefore = await one(ctx.db, "SELECT * FROM reservations WHERE id = ?", s.reservation.id);
    at(ctx, 20);
    const other = await registerCustomer(ctx, { nickname: "つぎ", phone: "08055550001" });
    const f = await fetchOffers(other.api, { party: 2 });
    expect(f.json.items.map((i: any) => i.offerId)).toContain(s.offer.id);
    expect((await receive(other.api, { offerId: s.offer.id, party: 2, fetchId: f.json.fetchId })).status).toBe(200);
    expect(await one(ctx.db, "SELECT * FROM reservations WHERE id = ?", s.reservation.id)).toEqual(rowBefore);
    const home = (await s.customer.api.get("/api/customer/home")).json;
    expect(home.kind).toBe("expired");
    expect(home.reservation.status).toBe("expired");
  });

  it("11.3 受付時間の終わり・公開の停止のどちらでも、確保の状態と期限が変わらない（組数などの変更はタスク20のブロック）", async () => {
    at(ctx, 0);
    const a = await receivedScene(ctx);
    const before = await read(ctx, a.reservation.id);
    await a.store.api.post("/api/store/offers/current/stop", {});
    expect(await read(ctx, a.reservation.id)).toEqual(before);
    expect((await a.customer.api.get("/api/customer/home")).json.kind).toBe("active");
    const b = await receivedScene(ctx);
    const beforeB = await read(ctx, b.reservation.id);
    // 何時までが 15:05 のオファー（公開のときに入れる）
    const c = await registerCustomer(ctx, { nickname: "みじかい", phone: "08055550009" });
    const s = await approvedStore(ctx);
    const offer = await publishOffer(s.api, { until: "15:05" });
    const f = await fetchOffers(c.api, { party: 2 });
    const r = await receive(c.api, { offerId: offer.id, party: 2, fetchId: f.json.fetchId });
    const beforeC = await read(ctx, r.json.reservation.id);
    at(ctx, 6);
    expect(await read(ctx, r.json.reservation.id)).toEqual(beforeC);
    expect((await c.api.get("/api/customer/home")).json.kind).toBe("active");
    expect(await read(ctx, b.reservation.id)).toEqual(beforeB);
    at(ctx, 0);
  });

  it("11.4 期限を延ばす入口が無い", () => {
    const paths = ctx.app.routes.map((r: any) => `${r.method} ${r.path}`);
    expect(paths.filter((p: string) => /extend|prolong|expires|expiry|renew/.test(p))).toEqual([]);
  });

  it("11.5・11.6・11.7・11.8・11.9 期限切れの表示: 20分の内はコードを出し、受け取れる状態なら受け取り直せる。止められていれば探し直す。20分を過ぎるとコードが消える", async () => {
    at(ctx, 0);
    const s = await receivedScene(ctx, { capacity: 3, partyMax: 4, party: 2 });
    at(ctx, 25);
    let home = (await s.customer.api.get("/api/customer/home")).json;
    expect(home.kind).toBe("expired");
    expect(home.expired).toEqual({ showCode: true, canRetry: true });
    expect(home.reservation.code).toBe(s.reservation.code);
    await s.store.api.post("/api/store/offers/current/stop", {});
    home = (await s.customer.api.get("/api/customer/home")).json;
    expect(home.expired.canRetry).toBe(false);
    expect(home.expired.showCode).toBe(true);
    at(ctx, 41);
    home = (await s.customer.api.get("/api/customer/home")).json;
    expect(home.kind).toBe("expired");
    expect(home.expired.showCode).toBe(false);
    expect(home.reservation.code ?? "").toBe("");
    at(ctx, 0);
  });

  it("11.10 期限切れの表示から受け取り直すと、新しい確保と新しいコードができ、人数は元の確保から取る", async () => {
    at(ctx, 0);
    const s = await receivedScene(ctx, { capacity: 3, party: 3 });
    at(ctx, 25);
    const r = await s.customer.api.post("/api/customer/reservations", { retryOf: s.reservation.id });
    expect(r.status).toBe(200);
    expect(r.json.reservation.id).not.toBe(s.reservation.id);
    expect(r.json.reservation.code).not.toBe(s.reservation.code);
    expect(r.json.reservation.party).toBe(3);
    expect(r.json.home.kind).toBe("active");
    expect((await one(ctx.db, "SELECT status FROM reservations WHERE id = ?", s.reservation.id)).status).toBe("active");
    at(ctx, 0);
  });

  it("11.10 受け取り直しが満席で断られると sold_out・search_again と home（受け取り直せない期限切れ）が載る。20分を過ぎた確保は受け取り直せない", async () => {
    at(ctx, 0);
    const s = await receivedScene(ctx, { capacity: 1, party: 2 });
    at(ctx, 25);
    const taker = await registerCustomer(ctx, { nickname: "よこどり", phone: "08055550002" });
    const f = await fetchOffers(taker.api, { party: 2 });
    expect((await receive(taker.api, { offerId: s.offer.id, party: 2, fetchId: f.json.fetchId })).status).toBe(200);
    const full = await s.customer.api.post("/api/customer/reservations", { retryOf: s.reservation.id });
    expect(full.status).toBe(409);
    expect(full.json.refusal).toMatchObject({ kind: "sold_out", nextStep: "search_again" });
    expect(full.json.home.expired.canRetry).toBe(false);
    at(ctx, 41);
    const late = await s.customer.api.post("/api/customer/reservations", { retryOf: s.reservation.id });
    expect(late.status).toBe(409);
    at(ctx, 0);
  });
});

describeTask("17", "店が期限切れの確保を完了済みにすると、客の表示は完了済み（11.11）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("11.11 期限切れの表示が完了済みの表示に変わり、受け取り直しは断られて home が完了済み", async () => {
    at(ctx, 0);
    const s = await receivedScene(ctx);
    at(ctx, 25);
    expect((await s.customer.api.get("/api/customer/home")).json.kind).toBe("expired");
    expect((await s.store.api.post(`/api/store/reservations/${s.reservation.id}/complete`, {})).status).toBe(200);
    expect((await s.customer.api.get("/api/customer/home")).json.kind).toBe("completed");
    const retry = await s.customer.api.post("/api/customer/reservations", { retryOf: s.reservation.id });
    expect(retry.status).toBe(409);
    expect(retry.json.home.kind).toBe("completed");
    at(ctx, 0);
  });
});

describeTask("20", "公開中の変更は確保の状態と期限を変えない（11.3）。何名までが下がると受け取り直せない（11.8・11.9・11.10）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("11.3 組数・何名まで・何時までの変更で、確保の状態と期限が変わらない", async () => {
    at(ctx, 0);
    const a = await receivedScene(ctx);
    const before = await read(ctx, a.reservation.id);
    await a.store.api.post("/api/store/offers/current/add", { count: 2 });
    await a.store.api.post("/api/store/offers/current/reduce", { count: 1 });
    await a.store.api.post("/api/store/offers/current/party-max", { partyMax: 1 });
    await a.store.api.post("/api/store/offers/current/until", { until: "15:05" });
    expect(await read(ctx, a.reservation.id)).toEqual(before);
    at(ctx, 6);
    expect(await read(ctx, a.reservation.id)).toEqual(before);
    expect((await a.customer.api.get("/api/customer/home")).json.kind).toBe("active");
    at(ctx, 0);
  });

  it("11.8・11.9・11.10 何名までが人数より下がると受け取り直せず（canRetry false・partyMax つき）、受け取り直しは party_over_max・search_again_with_party", async () => {
    at(ctx, 0);
    const s = await receivedScene(ctx, { capacity: 3, partyMax: 4, party: 2 });
    at(ctx, 25);
    await s.store.api.post("/api/store/offers/current/party-max", { partyMax: 1 });
    const home = (await s.customer.api.get("/api/customer/home")).json;
    expect(home.expired).toEqual({ showCode: true, canRetry: false, partyMax: 1 });
    const over = await s.customer.api.post("/api/customer/reservations", { retryOf: s.reservation.id });
    expect(over.status).toBe(409);
    expect(over.json.refusal).toMatchObject({ kind: "party_over_max", partyMax: 1, nextStep: "search_again_with_party" });
    expect(over.json.home.kind).toBe("expired");
    await s.store.api.post("/api/store/offers/current/party-max", { partyMax: 4 });
    expect((await s.customer.api.get("/api/customer/home")).json.expired.canRetry).toBe(true);
    at(ctx, 0);
  });
});
