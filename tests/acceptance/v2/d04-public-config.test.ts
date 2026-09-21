// 設計の決め: 公開してよい値の経路が入口1本（GET /api/config/public）。秘密の値が混ざらない。無記名で通る。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { makeCtx, type Ctx } from "./_fakes";

const SECRET_MARKERS = { TURNSTILE_SECRET_KEY: "marker-turnstile-secret", VAPID_PRIVATE_KEY: "marker-vapid-private", ORCAROUTER_API_KEY: "marker-orca-key", STRIPE_SECRET_KEY: "sk_test_marker", GOOGLE_MAPS_API_KEY: "marker-google" };

describeTask("3", "公開値の入口", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx({ deps: { config: { turnstileSiteKey: "site-A", vapidPublicKey: "vapid-A", contactEmail: null, orcarouterModel: "orcarouter/auto", ...SECRET_MARKERS } as any } });
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("偽の設定の値をそのまま返し、設定を変えると応答も変わる。応答の項目はその3つだけ", async () => {
    const a = await ctx.api().get("/api/config/public");
    expect(a.status).toBe(200);
    expect(a.json).toEqual({ turnstileSiteKey: "site-A", vapidPublicKey: "vapid-A", contactEmail: null });
    const other = await ctx.withDeps({ config: { ...ctx.deps.config, turnstileSiteKey: "site-B", vapidPublicKey: "vapid-B" } });
    const b = await other.api().get("/api/config/public");
    expect(b.json).toEqual({ turnstileSiteKey: "site-B", vapidPublicKey: "vapid-B", contactEmail: null });
  });

  it("秘密の値（目印の文字列）が応答の本文に1つも無い。応答のスキーマにその3項目しか無い", async () => {
    const r = await ctx.api().get("/api/config/public");
    for (const marker of Object.values(SECRET_MARKERS)) expect(r.text).not.toContain(marker);
    expect(r.text).not.toMatch(/SECRET|PRIVATE|API_KEY/);
    const routes = ctx.app.routes.filter((x: any) => x.path === "/api/config/public");
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ method: "GET", auth: "public", human: false });
  });

  it("Cookie もセッションも無しで通る（無記名）。Origin も要らない（読むだけ）", async () => {
    const r = await ctx.api().raw(new Request("https://app.test/api/config/public"));
    expect(r.status).toBe(200);
  });
});

describeTask("31", "【最終日】運営の連絡先も同じ入口が返す（14.17）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx({ deps: { config: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: "unei@example.com", orcarouterModel: "orcarouter/auto" } } });
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("設定の contactEmail を返し、変えると応答も変わる", async () => {
    expect((await ctx.api().get("/api/config/public")).json.contactEmail).toBe("unei@example.com");
    const other = await ctx.withDeps({ config: { ...ctx.deps.config, contactEmail: "help@example.org" } });
    expect((await other.api().get("/api/config/public")).json.contactEmail).toBe("help@example.org");
  });
});
