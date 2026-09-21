// 設計の決め: 他のサイトからの書き込みの要求を断る（Origin の確かめ）。書き込みの入口の全部を、正しい Cookie・セッションのまま、別のオリジン／なし／null で叩く。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { makeCtx, ORIGIN, receivedScene, registerCustomer, snapshot, type Ctx } from "./_fakes";

describeTask("25", "Origin の確かめ", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("書き込みの入口の全部が、別のオリジン／Origin なし／null で断られ、D1 が変わらない。同じオリジンなら通る（少なくとも断られない）", async () => {
    const scene = await receivedScene(ctx, { capacity: 3 });
    const customer = await registerCustomer(ctx, { nickname: "おりじん", phone: "08017170001" });
    const cookies: Record<string, string | null> = { public: null, customer: customer.cookie, store: scene.store.cookie, admin: ctx.admin!.cookie };
    const writes = ctx.app.routes.filter((r: any) => r.method !== "GET");
    expect(writes.length).toBeGreaterThan(20);
    const before = await snapshot(ctx.db, { except: ["rate_counters"] });
    for (const r of writes) {
      const path = r.path.replace(/:(\w+)/g, () => scene.reservation.id);
      for (const [label, origin] of [["別のオリジン", "https://evil.example"], ["Origin なし", null], ["null", "null"]] as const) {
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (origin !== null) headers.origin = origin;
        if (cookies[r.auth]) headers.cookie = cookies[r.auth]!;
        const res = await ctx.app.fetch(new Request(`${ORIGIN}${path}`, { method: r.method, headers, body: "{}" }));
        expect(res.status, `${r.method} ${path}（${label}）`).toBe(403);
        const json = await res.json().catch(() => null);
        expect(json?.ok, `${r.method} ${path}（${label}）`).toBe(false);
      }
    }
    expect(await snapshot(ctx.db, { except: ["rate_counters"] })).toBe(before);
    const same = await ctx.app.fetch(new Request(`${ORIGIN}/api/customer/reservations/${scene.reservation.id}/party`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, cookie: scene.customer.cookie }, body: JSON.stringify({ party: 3 }) }));
    expect(same.status).toBe(200);
  });

  it("読むだけの入口（GET）は Origin が無くても通る", async () => {
    const scene = await receivedScene(ctx);
    const res = await ctx.app.fetch(new Request(`${ORIGIN}/api/customer/home`, { headers: { cookie: scene.customer.cookie } }));
    expect(res.status).toBe(200);
    expect((await ctx.app.fetch(new Request(`${ORIGIN}/api/config/public`))).status).toBe(200);
  });
});
