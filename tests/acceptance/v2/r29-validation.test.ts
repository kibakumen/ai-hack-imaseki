// 要件29 入力の検査（入口）: 29.2・29.3 全部の入口に壊れた入力を送る。29.1・29.4 は structure.test.ts。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { loadWeb, makeCtx, receivedScene, registerCustomer, snapshot, type Ctx } from "./_fakes";

describeTask("25", "全部の入口の入力の検査", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("29.2・29.3 本文のある入口の全部に壊れた入力（型違い・欠け・JSON でない）を送り、schemas/error の形で返り、人が読む文が無く、D1 が変わらない", async () => {
    const scene = await receivedScene(ctx);
    const customer = await registerCustomer(ctx, { nickname: "けんさ", phone: "08016160001" });
    const apis: Record<string, any> = { public: ctx.api(), customer: customer.api, store: scene.store.api, admin: ctx.admin!.api };
    const { INPUT_REFUSAL_KINDS, FIELD_REASONS } = await loadWeb("lib/domain/inputRefusal");
    const { errorSchema } = await loadWeb("lib/schemas/error");
    const routes = ctx.app.routes.filter((r: any) => r.method !== "GET" && !/logout|\/stop$|\/complete$|\/cancel$|\/approve$|\/ban$|\/restore$|\/temp-password$|card\/setup$|^\/api\/customer$/.test(r.path));
    expect(routes.length).toBeGreaterThan(12);
    const before = await snapshot(ctx.db, { except: ["rate_counters"] });
    let checked = 0;
    for (const r of routes) {
      const path = r.path.replace(/:(\w+)/g, () => scene.reservation.id);
      const api = apis[r.auth];
      const bodies: Array<{ label: string; body: unknown; init?: RequestInit }> = [
        { label: "型違い", body: { nickname: 1, phone: true, party: "二", email: 5, password: [], name: {}, capacity: "多め", count: null, partyMax: "x", until: 1500, storeId: 9, reason: 3, subscription: "x", couponIds: "a", genres: "和食", budgetMax: "安め", place: 99, sessionId: 1, retryOf: 7, offerId: false, fetchId: null, url: 1, address: 2, menus: "x", budgetMin: "a", note: 4, humanToken: 1 } },
        { label: "欠け", body: {} },
        { label: "JSON でない", body: undefined, init: { headers: { "content-type": "application/json", origin: "https://app.test" }, body: "{ not json" } as any },
      ];
      for (const b of bodies) {
        const res = b.init ? await api.raw(new Request(`https://app.test${path}`, { method: r.method, ...b.init, headers: { ...(b.init.headers as any), cookie: api.cookie ?? "" } })) : await api[r.method.toLowerCase()](path, b.body);
        const label = `${r.method} ${path}（${b.label}）`;
        expect([400, 404, 409, 415], label).toContain(res.status);
        if (res.status === 404) continue;
        expect(res.json?.ok, label).toBe(false);
        expect(errorSchema.safeParse(res.json).success, `${label}: ${res.text}`).toBe(true);
        expect(INPUT_REFUSAL_KINDS, label).toContain(res.json.error.kind);
        for (const f of res.json.error.fields ?? []) expect(FIELD_REASONS, label).toContain(f.reason);
        expect(res.text, label).not.toMatch(/[ぁ-んァ-ン一-龠]/);
        if (b.label !== "JSON でない" && res.json.error.kind === "invalid_input") expect(res.json.error.fields.length, label).toBeGreaterThan(0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(30);
    expect(await snapshot(ctx.db, { except: ["rate_counters"] })).toBe(before);
  });

  it("29.2 どの項目が誤りかが返る（2つ壊すと2つ返る）", async () => {
    const r = await ctx.api().post("/api/register/customer", { nickname: "", phone: "abc", genres: [], humanToken: "tok" });
    expect(r.status).toBe(400);
    expect(r.json.error.fields.map((f: any) => f.name).sort()).toEqual(["nickname", "phone"]);
  });
});
