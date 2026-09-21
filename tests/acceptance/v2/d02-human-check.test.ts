// 設計の決め: 人かどうかの確かめ（Turnstile）が、客の登録・店の登録・ログインの3つの入口を守る。
// 確かめの値が無い／人でない／確かめが失敗／3秒返らない、のどれでも断り、D1 は変わらない。人であれば通る。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { CUSTOMER, loadWeb, makeCtx, snapshot, type Ctx } from "./_fakes";

const customerBody = (token: string | undefined) => ({ ...CUSTOMER, phone: "08012340000", ...(token === undefined ? {} : { humanToken: token }) });

const expectRefusedUnchanged = async (ctx: Ctx, path: string, body: unknown, label: string) => {
  const before = await snapshot(ctx.db, { except: ["rate_counters"] });
  const r = await ctx.api().post(path, body);
  expect([400, 403], label).toContain(r.status);
  expect(r.json.ok, label).toBe(false);
  expect(r.json.error.kind, label).toBe("human_check_failed");
  expect(await snapshot(ctx.db, { except: ["rate_counters"] }), label).toBe(before);
};

describeTask("3", "客の登録を人かどうかの確かめが守る", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("確かめの値が無い／人でない／確かめが失敗、のそれぞれで断り D1 が変わらない。人であれば通る", async () => {
    ctx.human.mode = "human";
    await expectRefusedUnchanged(ctx, "/api/register/customer", customerBody(undefined), "値なし");
    expect(ctx.human.tokens.at(-1) ?? null).toBeNull();
    ctx.human.mode = "bot";
    await expectRefusedUnchanged(ctx, "/api/register/customer", customerBody("tok-bot"), "人でない");
    ctx.human.mode = "fail";
    await expectRefusedUnchanged(ctx, "/api/register/customer", customerBody("tok-fail"), "失敗");
    ctx.human.mode = "human";
    const ok = await ctx.api().post("/api/register/customer", customerBody("tok-ok"));
    expect([200, 201]).toContain(ok.status);
    expect(ctx.human.tokens).toContain("tok-ok");
  });

  it("3秒返らないと断る（偽の時計）", async () => {
    ctx.human.mode = "hang";
    const before = await snapshot(ctx.db, { except: ["rate_counters"] });
    const pending = ctx.api().post("/api/register/customer", customerBody("tok-hang"));
    await ctx.clock.advance(3_100);
    const r = await pending;
    expect([400, 403]).toContain(r.status);
    expect(r.json.error.kind).toBe("human_check_failed");
    expect(await snapshot(ctx.db, { except: ["rate_counters"] })).toBe(before);
    ctx.human.mode = "human";
  });

  it("客の入口（ホーム）は確かめの値を求めない", async () => {
    ctx.human.mode = "bot";
    const reg = await ctx.api().post("/api/register/customer", customerBody("x"));
    expect(reg.status).not.toBe(200);
    ctx.human.mode = "human";
    const ok = await ctx.api().post("/api/register/customer", customerBody("tok-ok"));
    const cookie = ok.setCookies[0].split(";")[0];
    const calls = ctx.human.tokens.length;
    ctx.human.mode = "bot";
    const home = await ctx.api(cookie).get("/api/customer/home");
    expect(home.status).toBe(200);
    expect(ctx.human.tokens.length).toBe(calls);
    ctx.human.mode = "human";
  });

  it("入口の一覧で、human が true なのは客の登録・店の登録・ログインの3つだけ", async () => {
    const human = ctx.app.routes.filter((r: any) => r.human).map((r: any) => `${r.method} ${r.path}`).sort();
    expect(human).toEqual(["POST /api/auth/login", "POST /api/register/customer", "POST /api/register/store"]);
  });
});

describeTask("4", "店の登録とログインを人かどうかの確かめが守る", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("店の登録: 値なし／人でない／失敗／3秒返らない、で断り D1 が変わらない", async () => {
    const body = { name: "検査の店", email: "human-check@example.com", password: "store-pass-1234" };
    ctx.human.mode = "human";
    await expectRefusedUnchanged(ctx, "/api/register/store", body, "値なし");
    ctx.human.mode = "bot";
    await expectRefusedUnchanged(ctx, "/api/register/store", { ...body, humanToken: "t" }, "人でない");
    ctx.human.mode = "fail";
    await expectRefusedUnchanged(ctx, "/api/register/store", { ...body, humanToken: "t" }, "失敗");
    ctx.human.mode = "hang";
    const before = await snapshot(ctx.db, { except: ["rate_counters"] });
    const pending = ctx.api().post("/api/register/store", { ...body, humanToken: "t" });
    await ctx.clock.advance(3_100);
    expect((await pending).json.error.kind).toBe("human_check_failed");
    expect(await snapshot(ctx.db, { except: ["rate_counters"] })).toBe(before);
    ctx.human.mode = "human";
    const ok = await ctx.api().post("/api/register/store", { ...body, humanToken: "tok-ok" });
    expect([200, 201]).toContain(ok.status);
  });

  it("ログイン: 正しい組でも、人でない／値なしなら断り、セッションが作られない", async () => {
    const { seedAdmin } = await loadWeb("lib/usecases/seedAdmin");
    await seedAdmin(ctx.deps, { email: "admin-hc@example.com", password: "admin-pass-1234" });
    const body = { email: "admin-hc@example.com", password: "admin-pass-1234" };
    ctx.human.mode = "human";
    await expectRefusedUnchanged(ctx, "/api/auth/login", body, "値なし");
    ctx.human.mode = "bot";
    await expectRefusedUnchanged(ctx, "/api/auth/login", { ...body, humanToken: "t" }, "人でない");
    ctx.human.mode = "human";
    const ok = await ctx.api().post("/api/auth/login", { ...body, humanToken: "tok-ok" });
    expect(ok.status).toBe(200);
    expect(ok.setCookies[0]).toBeTruthy();
  });
});
