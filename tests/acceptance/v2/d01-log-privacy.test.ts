// 設計の決め: ログに個人データを出さない（振る舞い）。console の全部の出口を捕まえ、偽の Logger に渡った項目も見る。
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { describeTask } from "./_tasks";
import { approvedStore, fetchOffers, loadWeb, makeCtx, publishOffer, receive, registerCustomer, type Ctx } from "./_fakes";

const MARKERS = { nickname: "めじるしのなまえ", phone: "08019190019", storeEmail: "marker-store@example.com", password: "marker-password-9", place: "めじるしの場所", reason: "めじるしの理由" };

describeTask("25", "ログに個人データを出さない", () => {
  let ctx: Ctx;
  const captured: string[] = [];
  beforeAll(async () => {
    ctx = await makeCtx();
    for (const m of ["log", "error", "warn", "info", "debug"] as const) vi.spyOn(console, m).mockImplementation((...args: unknown[]) => captured.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ")));
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await ctx.dispose();
  });

  it("客の登録・取得・受け取り・店の登録・ログイン・通報を、通る場合と壊れた入力・偽の AI の失敗・偽の地図の失敗の場合の両方で走らせ、console にも Logger にも目印の値が無い。Logger には自由な文字列の項目が無い", async () => {
    const { createLogger } = await loadWeb("lib/adapters/logger");
    const real = createLogger();
    const both = { log: (entry: any) => (ctx.logger.log(entry), real.log(entry)) };
    const rc = await ctx.withDeps({ logger: both });
    const store = await approvedStore(rc, { name: "ログの店", email: MARKERS.storeEmail, password: MARKERS.password });
    await publishOffer(store.api);
    const c = await registerCustomer(rc, { nickname: MARKERS.nickname, phone: MARKERS.phone });
    const f = await fetchOffers(c.api, { party: 2 });
    await receive(c.api, { offerId: (await store.api.get("/api/store/home")).json.offer.id, party: 2, fetchId: f.json.fetchId });
    await c.api.post("/api/customer/reports", { storeId: store.id, reason: MARKERS.reason });
    await rc.api().post("/api/auth/login", { email: MARKERS.storeEmail, password: MARKERS.password, humanToken: "tok-ok" });
    await rc.api().post("/api/register/customer", { nickname: MARKERS.nickname, phone: "abc", genres: [], humanToken: "tok-ok" });
    await rc.api().post("/api/register/store", { name: "x", email: MARKERS.storeEmail, password: MARKERS.password, humanToken: "tok-ok" });
    rc.ai.respond(() => {
      throw new Error(`AI down while serving ${MARKERS.nickname}`);
    });
    await fetchOffers(c.api, { party: 2 });
    rc.geocoder.set(MARKERS.place, "fail");
    await c.api.post("/api/customer/fetch", { place: MARKERS.place, party: 2, genres: [], budgetMax: null });
    await c.api.post("/api/customer/reports", { storeId: store.id, reason: "" });
    await rc.api().raw(new Request("https://app.test/api/register/customer", { method: "POST", headers: { "content-type": "application/json", origin: "https://app.test" }, body: `{ broken ${MARKERS.nickname}` }));

    const cookieValue = c.cookie.split("=").slice(1).join("=");
    const all = captured.join("\n") + "\n" + JSON.stringify(ctx.logger.entries);
    for (const [k, v] of Object.entries({ ...MARKERS, cookieValue })) expect(all, k).not.toContain(v);
    expect(ctx.logger.entries.length).toBeGreaterThan(0);
    for (const e of ctx.logger.entries as any[]) {
      for (const [k, v] of Object.entries(e)) {
        if (typeof v === "string") expect(["event", "errorKind", "id"], `Logger の項目 ${k} が自由な文字列`).toContain(k);
        if (k === "event" || k === "errorKind") expect(v as string, k).toMatch(/^[a-z0-9_.-]+$/);
      }
    }
  });
});
