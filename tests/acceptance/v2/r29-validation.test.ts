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
    const coupon = await scene.store.api.post("/api/store/coupons", { name: "けんさのクーポン", note: "" });
    expect([200, 201]).toContain(coupon.status);
    const customer = await registerCustomer(ctx, { nickname: "けんさ", phone: "08016160001" });
    const apis: Record<string, any> = { public: ctx.api(), customer: customer.api, store: scene.store.api, admin: ctx.admin!.api };
    const { INPUT_REFUSAL_KINDS, FIELD_REASONS } = await loadWeb("lib/domain/inputRefusal");
    const { errorSchema } = await loadWeb("lib/schemas/error");
    // 本文を持たない入口（操作の名前だけで決まるもの・消すもの）と、本文の項目が全部任意の入口（止める・戻すの理由・運営-01）は除く。
    // 仮のパスワードの発行は運営の今のパスワードを求めるようになった（運営-01 の案3）ので、本文のある入口として検査する。
    const bodyless = (r: { method: string; path: string }) => /logout|\/stop$|\/complete$|\/cancel$|\/approve$|\/ban$|\/restore$|\/acknowledge$|card\/setup$|^\/api\/customer$/.test(r.path) || (r.method === "DELETE" && r.path === "/api/store/coupons/:id");
    const routes = ctx.app.routes.filter((r: any) => r.method !== "GET" && !bodyless(r));
    expect(routes.length).toBeGreaterThan(12);
    const before = await snapshot(ctx.db, { except: ["rate_counters"] });
    let checked = 0;
    // 動的な区間には、その入口が指す実在の物の番号を入れる（在らない番号で 404 になって、入力の検査を素通りしないように・設計-04）
    const idFor = (routePath: string): string => {
      if (routePath.startsWith("/api/store/coupons/")) return coupon.json.coupon.id;
      if (routePath.startsWith("/api/admin/stores/")) return scene.store.id;
      return scene.reservation.id;
    };
    const notFound: string[] = [];
    for (const r of routes) {
      const path = r.path.replace(/:(\w+)/g, () => idFor(r.path));
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
        if (res.status === 404) {
          notFound.push(label);
          continue;
        }
        expect(res.json?.ok, label).toBe(false);
        expect(errorSchema.safeParse(res.json).success, `${label}: ${res.text}`).toBe(true);
        expect(INPUT_REFUSAL_KINDS, label).toContain(res.json.error.kind);
        for (const f of res.json.error.fields ?? []) expect(FIELD_REASONS, label).toContain(f.reason);
        expect(res.text, label).not.toMatch(/[ぁ-んァ-ン一-龠]/);
        if (b.label !== "JSON でない" && res.json.error.kind === "invalid_input") expect(res.json.error.fields.length, label).toBeGreaterThan(0);
        checked++;
      }
    }
    // 404 は「入口が無い」＝入力の検査に届いていない。読み飛ばさずに全部を検査する
    expect(notFound).toEqual([]);
    expect(checked).toBeGreaterThan(30);
    expect(await snapshot(ctx.db, { except: ["rate_counters"] })).toBe(before);
  });

  // 要求の本文を丸ごと読んでから大きさを見ていた。上限（既定16KB）を超えたら、読み切る前に 413 で断る（安全-13）。
  it("安全-13: 本文が大きすぎる要求（約120KB）は 413 で断り、D1 が変わらない", async () => {
    const scene = await receivedScene(ctx);
    const before = await snapshot(ctx.db, { except: ["rate_counters"] });
    const r = await scene.customer.api.post("/api/customer/reports", { storeId: scene.store.id, reason: "あ".repeat(40_000) });
    expect(r.status).toBe(413);
    expect(r.json.error.kind).toBe("body_too_large");
    expect(await snapshot(ctx.db, { except: ["rate_counters"] })).toBe(before);
  });

  it("29.2 どの項目が誤りかが返る（2つ壊すと2つ返る）", async () => {
    const r = await ctx.api().post("/api/register/customer", { nickname: "", phone: "abc", genres: [], humanToken: "tok" });
    expect(r.status).toBe(400);
    expect(r.json.error.fields.map((f: any) => f.name).sort()).toEqual(["nickname", "phone"]);
  });
});
