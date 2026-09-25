// 見分けと「見つからない」の断りの語（監査の指摘 横断-01・2026-09-25）。
//
// それまで未ログイン（401）・役割違い（403）・見つからない（404）が全部 `invalid_input` で返り、
// 画面は「入れた内容を確かめてください」と出すか、空の一覧を出すしかなかった。
// 断りの語に unauthenticated・forbidden・not_found を足し、全部の入口がこの3つで返すことを見る。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvedStore, makeCtx, ORIGIN, receivedScene, registerCustomer, type Ctx } from "../../../tests/acceptance/v2/_fakes";

type RouteInfo = { method: string; path: string; auth: string; human: boolean };

const callOf = (api: Record<string, unknown>, method: string) => api[method === "DELETE" ? "del" : method.toLowerCase()] as (p: string, b?: unknown) => Promise<{ status: number; json: { ok?: boolean; error?: { kind?: string } } | null }>;

describe("見分けと「見つからない」の断りの語", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("見分けの要る入口の全部が、Cookie 無しで 401・unauthenticated を返す", async () => {
    const routes = (ctx.app.routes as RouteInfo[]).filter((r) => r.auth !== "public");
    expect(routes.length).toBeGreaterThan(30);
    for (const r of routes) {
      const path = r.path.replace(/:(\w+)/g, "x");
      const res = await callOf(ctx.api() as unknown as Record<string, unknown>, r.method)(path, r.method === "GET" ? undefined : {});
      const label = `${r.method} ${r.path}`;
      expect(res.status, label).toBe(401);
      expect(res.json?.ok, label).toBe(false);
      expect(res.json?.error?.kind, label).toBe("unauthenticated");
    }
  });

  it("運営の入口を店のセッションで叩くと 403・forbidden。店の入口を運営のセッションで叩いても 403・forbidden", async () => {
    const store = await approvedStore(ctx, { name: "見分けの店" });
    const routes = ctx.app.routes as RouteInfo[];
    for (const r of routes.filter((x) => x.auth === "admin")) {
      const res = await callOf(store.api as unknown as Record<string, unknown>, r.method)(r.path.replace(/:(\w+)/g, store.id), r.method === "GET" ? undefined : {});
      expect(res.status, `${r.method} ${r.path}`).toBe(403);
      expect(res.json?.error?.kind, `${r.method} ${r.path}`).toBe("forbidden");
    }
    for (const r of routes.filter((x) => x.auth === "store")) {
      const res = await callOf(ctx.admin!.api as unknown as Record<string, unknown>, r.method)(r.path.replace(/:(\w+)/g, "x"), r.method === "GET" ? undefined : {});
      expect(res.status, `${r.method} ${r.path}`).toBe(403);
      expect(res.json?.error?.kind, `${r.method} ${r.path}`).toBe("forbidden");
    }
  });

  it("書き込みの Origin が合わないときは 403・forbidden", async () => {
    const res = await ctx.app.fetch(new Request(`${ORIGIN}/api/register/customer`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: "{}" }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { kind: string } }).error.kind).toBe("forbidden");
  });

  it("在らない経路・在らない番号は 404・not_found（入口ごとに手で書かず、同じ形で返る）", async () => {
    const scene = await receivedScene(ctx);
    const customer = await registerCustomer(ctx, { nickname: "みつからない", phone: "08012120001" });
    const cases: Array<[string, Promise<{ status: number; json: { error?: { kind?: string } } | null }>]> = [
      ["在らない経路", ctx.api().get("/api/no-such-route")],
      ["運営の店の詳細", ctx.admin!.api.get("/api/admin/stores/no-such-store")],
      ["運営の承認", ctx.admin!.api.post("/api/admin/stores/no-such-store/approve", {})],
      ["運営の停止", ctx.admin!.api.post("/api/admin/stores/no-such-store/ban", {})],
      ["運営の戻す", ctx.admin!.api.post("/api/admin/stores/no-such-store/restore", {})],
      ["仮のパスワード", ctx.admin!.api.post("/api/admin/stores/no-such-store/temp-password", { currentPassword: ctx.admin!.password })],
      ["運営が読む許可書", ctx.admin!.api.get("/api/admin/stores/no-such-store/license")],
      ["店のクーポンの変更", scene.store.api.put("/api/store/coupons/no-such-coupon", { name: "x", note: "" })],
      ["店のクーポンの削除", scene.store.api.del("/api/store/coupons/no-such-coupon")],
      ["店の完了済み", scene.store.api.post("/api/store/reservations/no-such/complete", {})],
      ["店の取り消し", scene.store.api.post("/api/store/reservations/no-such/cancel", {})],
      ["客の取り消し", customer.api.post("/api/customer/reservations/no-such/cancel", {})],
      ["客の人数の変更", customer.api.post("/api/customer/reservations/no-such/party", { party: 2 })],
    ];
    for (const [label, pending] of cases) {
      const res = await pending;
      expect(res.status, label).toBe(404);
      expect(res.json?.error?.kind, label).toBe("not_found");
    }
  });
});
