// 要件22 客への知らせ（Web プッシュ）（手続き・純粋・Service Worker）。22.2 はタスク21。画面は r22-push.ui.test.tsx。22.13 は段3（本人）。
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
// 2026-09-22 の直し: 53〜60行が使う5つ（approvedStore・publishOffer・fetchOffers・registerCustomer・receive）が
// import されておらず、実行時に ReferenceError で落ちていた。型検査が通っていたのは acceptance-globals.d.ts が
// グローバルとして宣言していたためで、実行時にそれらを定義する場所はどこにも無い。ほかの受け入れ検査55ファイルは
// 全部 _fakes から明示 import しており、このファイルだけが取りこぼしていた。検査の意図は1文字も変えていない。
import { approvedStore, fetchOffers, loadWeb, makeCtx, one, publishOffer, receive, receivedScene, registerCustomer, WEB, type Ctx } from "./_fakes";

const SUBSCRIPTION = { endpoint: "https://push.example.test/sub/1", keys: { p256dh: "BPUB", auth: "AUTH" } };

describeTask("19", "Web プッシュを送る場面と送らない場面", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });
  const subscribed = async () => {
    const s = await receivedScene(ctx, { capacity: 3 });
    const r = await s.customer.api.post("/api/customer/push-subscription", { subscription: SUBSCRIPTION });
    expect(r.status).toBe(200);
    return s;
  };

  it("22.1 店が取り消すと、その客の購読へ1回送る（TTL は20分）。22.7 購読が無い客には送らない", async () => {
    const s = await subscribed();
    const before = ctx.push.calls.length;
    expect((await s.store.api.post(`/api/store/reservations/${s.reservation.id}/cancel`, {})).status).toBe(200);
    expect(ctx.push.calls.length).toBe(before + 1);
    expect(ctx.push.calls.at(-1)!.subscription).toMatchObject({ endpoint: SUBSCRIPTION.endpoint });
    expect(ctx.push.calls.at(-1)!.ttlSeconds).toBe(20 * 60);
    const none = await receivedScene(ctx);
    const n = ctx.push.calls.length;
    expect((await none.store.api.post(`/api/store/reservations/${none.reservation.id}/cancel`, {})).status).toBe(200);
    expect(ctx.push.calls.length).toBe(n);
  });

  it("22.3 期限切れ・客の取り消し・完了済み・公開の停止・受付時間の終わりでは0回（組数と何名までと何時までの変更はタスク20のブロック）", async () => {
    const check = async (label: string, act: (s: Awaited<ReturnType<typeof subscribed>>) => Promise<unknown>) => {
      ctx.clock.set("2026-09-22T06:00:00.000Z");
      const s = await subscribed();
      const before = ctx.push.calls.length;
      await act(s);
      await s.customer.api.get("/api/customer/home");
      await s.store.api.get("/api/store/home");
      expect(ctx.push.calls.length, label).toBe(before);
    };
    await check("期限切れ", async () => ctx.clock.set("2026-09-22T06:25:00.000Z"));
    await check("客の取り消し", (s) => s.customer.api.post(`/api/customer/reservations/${s.reservation.id}/cancel`, {}));
    await check("完了済み", (s) => s.store.api.post(`/api/store/reservations/${s.reservation.id}/complete`, {}));
    await check("公開の停止", (s) => s.store.api.post("/api/store/offers/current/stop", {}));
    await check("受付時間の終わり", async (s) => {
      const store = await approvedStore(ctx, { name: "短い店" });
      const offer = await publishOffer(store.api, { until: "15:05" });
      const f = await fetchOffers(s.customer.api, { party: 2 });
      void f;
      const c = await registerCustomer(ctx, { nickname: "みじかい", phone: "08066660009" });
      await c.api.post("/api/customer/push-subscription", { subscription: SUBSCRIPTION });
      const fc = await fetchOffers(c.api, { party: 2 });
      await receive(c.api, { offerId: offer.id, party: 2, fetchId: fc.json.fetchId });
      ctx.clock.set("2026-09-22T06:06:00.000Z");
      await c.api.get("/api/customer/home");
      await store.api.get("/api/store/home");
    });
    ctx.clock.set("2026-09-22T06:00:00.000Z");
  });

  it("22.6 送信が失敗しても（例外でも「もう無い」でも）取り消しは成立する。「もう無い」の購読は消える", async () => {
    const a = await subscribed();
    ctx.push.result = "throw";
    expect((await a.store.api.post(`/api/store/reservations/${a.reservation.id}/cancel`, {})).status).toBe(200);
    expect((await one(ctx.db, "SELECT status FROM reservations WHERE id = ?", a.reservation.id)).status).toBe("store_cancelled");
    const b = await subscribed();
    ctx.push.result = { ok: false, gone: true };
    expect((await b.store.api.post(`/api/store/reservations/${b.reservation.id}/cancel`, {})).status).toBe(200);
    expect((await one(ctx.db, "SELECT status FROM reservations WHERE id = ?", b.reservation.id)).status).toBe("store_cancelled");
    expect((await one(ctx.db, "SELECT COUNT(*) AS n FROM push_subscriptions WHERE subscription_json LIKE ?", `%${SUBSCRIPTION.endpoint}%`)).n).toBeLessThan(2);
    ctx.push.result = { ok: true };
  });

  it("22.4・22.5 場面ごとの決まった文。文を作る関数の入力に呼び名と電話番号が無く、/api/customer/push-message の応答にも無い。プッシュの中身は空", async () => {
    const { TEXTS } = await loadWeb("lib/domain/texts");
    const store = TEXTS.push("store_cancelled");
    const admin = TEXTS.push("admin_cancelled");
    expect(store.title.length).toBeGreaterThan(0);
    expect(store.body).not.toBe(admin.body);
    expect(TEXTS.push.length).toBeLessThanOrEqual(1);
    const s = await subscribed();
    await s.store.api.post(`/api/store/reservations/${s.reservation.id}/cancel`, {});
    const m = await s.customer.api.get("/api/customer/push-message");
    expect(m.status).toBe(200);
    expect(m.json).toEqual({ scene: "store_cancelled", ...store });
    expect(m.text).not.toContain("たなか");
    expect(m.text).not.toContain("09012345678");
    const call = ctx.push.calls.at(-1)!;
    expect(JSON.stringify(call)).not.toMatch(/たなか|09012345678|payload|body/);
    const none = await receivedScene(ctx);
    expect((await none.customer.api.get("/api/customer/push-message")).json.scene).toBeNull();
  });

  it("22.12 public/sw.js を偽の環境で読み、push で通知を出し、開くと /me が開く。通信に失敗すると共通の文", async () => {
    const src = fs.readFileSync(path.join(WEB, "public", "sw.js"), "utf8");
    const listeners: Record<string, (e: any) => void> = {};
    const shown: any[] = [];
    const opened: string[] = [];
    const self: any = {
      addEventListener: (name: string, fn: (e: any) => void) => {
        listeners[name] = fn;
      },
      registration: { showNotification: async (title: string, opts: any) => shown.push({ title, ...opts }) },
      clients: { openWindow: async (url: string) => opened.push(url), matchAll: async () => [] },
      skipWaiting: () => {},
      caches: { open: async () => ({ put: async () => {}, match: async () => undefined }) },
    };
    let fetchMode: "ok" | "fail" = "ok";
    const fakeFetch = async () => {
      if (fetchMode === "fail") throw new TypeError("offline");
      return new Response(JSON.stringify({ scene: "admin_cancelled", title: "運営が停止", body: "運営の停止で取り消し" }), { headers: { "content-type": "application/json" } });
    };
    new Function("self", "fetch", "caches", "addEventListener", "clients", "registration", src)(self, fakeFetch, self.caches, self.addEventListener, self.clients, self.registration);
    expect(listeners.push).toBeTruthy();
    const waitUntil = async (fn: (e: any) => void) => {
      const promises: Promise<unknown>[] = [];
      fn({ waitUntil: (p: Promise<unknown>) => promises.push(p), notification: { close: () => {} }, data: null });
      await Promise.all(promises);
    };
    await waitUntil(listeners.push);
    expect(shown.at(-1).title).toBe("運営が停止");
    fetchMode = "fail";
    await waitUntil(listeners.push);
    expect(shown.at(-1).body).toMatch(/取り消されました/);
    expect(shown.at(-1).body).toMatch(/開いて/);
    await waitUntil(listeners.notificationclick);
    expect(opened.at(-1)).toMatch(/\/me$/);
  });
});

describeTask("21", "運営の停止で客へ送る（22.2）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("22.2 運営が店を止めると、購読のある客に1回ずつ送り、運営の停止の文になる。購読の無い客には送らない", async () => {
    const s = await receivedScene(ctx, { capacity: 3 });
    await s.customer.api.post("/api/customer/push-subscription", { subscription: SUBSCRIPTION });
    const before = ctx.push.calls.length;
    await ctx.admin!.api.post(`/api/admin/stores/${s.store.id}/ban`, {});
    expect(ctx.push.calls.length).toBe(before + 1);
    expect((await s.customer.api.get("/api/customer/push-message")).json.scene).toBe("admin_cancelled");
  });
});
