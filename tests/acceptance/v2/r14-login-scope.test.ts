// 要件14 店と運営のログインと見える範囲。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { approvedStore, cookieOf, loadWeb, makeCtx, one, ORIGIN, receivedScene, registerStore, rows, seedAdmin, snapshot, type Ctx } from "./_fakes";

describeTask("4", "ログインとセッション", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("14.1・14.9 ログイン前は店の入口が 401（運営の入口の全部はタスク25のブロック）。正しい組でセッションの Cookie が出て、店の入口が通る。logout で通らなくなる", async () => {
    const s = await registerStore(ctx, { email: "login-1@example.com", password: "store-pass-1234" });
    expect((await ctx.api().get("/api/store/home")).status).toBe(401);
    expect(ctx.app.routes.filter((r: any) => r.auth === "store").length).toBeGreaterThan(0);
    const login = await ctx.api().post("/api/auth/login", { email: "login-1@example.com", password: "store-pass-1234", humanToken: "tok-ok" });
    expect(login.status).toBe(200);
    expect(login.json.role).toBe("store");
    const set = login.setCookies[0];
    expect(set).toMatch(/HttpOnly/i);
    expect(set).toMatch(/SameSite=Lax/i);
    const cookie = cookieOf(login)!;
    expect(cookie).not.toBe(s.cookie);
    expect((await ctx.api(cookie).get("/api/store/home")).status).toBe(200);
    expect((await ctx.api(cookie).post("/api/auth/logout", {})).status).toBe(200);
    expect((await ctx.api(cookie).get("/api/store/home")).status).toBe(401);
  });

  it("14.2 メールアドレス違いとパスワード違いで同じ誤り（login_failed）が返り、どちらが違うかが分からない", async () => {
    await registerStore(ctx, { email: "login-2@example.com", password: "store-pass-1234" });
    const wrongEmail = await ctx.api().post("/api/auth/login", { email: "nobody-2@example.com", password: "store-pass-1234", humanToken: "tok-ok" });
    const wrongPass = await ctx.api().post("/api/auth/login", { email: "login-2@example.com", password: "store-pass-0000", humanToken: "tok-ok" });
    for (const r of [wrongEmail, wrongPass]) {
      expect([400, 401]).toContain(r.status);
      expect(r.json.error.kind).toBe("login_failed");
      expect(r.setCookies).toEqual([]);
    }
    expect(wrongEmail.status).toBe(wrongPass.status);
    expect(JSON.stringify(wrongEmail.json)).toBe(JSON.stringify(wrongPass.json));
  });

  it("14.3 ログインの入口は URL の問い合わせ文字列を読まない", async () => {
    await registerStore(ctx, { email: "login-3@example.com", password: "store-pass-1234" });
    const r = await ctx.api().raw(new Request(`${ORIGIN}/api/auth/login?email=login-3%40example.com&password=store-pass-1234&humanToken=tok-ok`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: "{}" }));
    expect(r.status).not.toBe(200);
    expect(r.setCookies).toEqual([]);
    const login = ctx.app.routes.find((x: any) => x.path === "/api/auth/login");
    expect(login).toMatchObject({ method: "POST", auth: "public", human: true });
  });

  it("14.4 保存された値に平文が無く、同じパスワードでも店ごとに別の値", async () => {
    await registerStore(ctx, { email: "same-1@example.com", password: "same-password-99" });
    await registerStore(ctx, { email: "same-2@example.com", password: "same-password-99" });
    const a = await one(ctx.db, "SELECT password_hash FROM accounts WHERE email = ?", "same-1@example.com");
    const b = await one(ctx.db, "SELECT password_hash FROM accounts WHERE email = ?", "same-2@example.com");
    expect(a.password_hash).not.toContain("same-password-99");
    expect(a.password_hash).not.toBe(b.password_hash);
    expect(a.password_hash.length).toBeGreaterThan(40);
    const { parsePasswordRecord } = await loadWeb("lib/domain/password");
    const parsed = parsePasswordRecord(a.password_hash);
    expect(parsed.iterations).toBeGreaterThanOrEqual(10_000);
    expect(parsed.salt).not.toBe(parsePasswordRecord(b.password_hash).salt);
  });

  it("14.8 登録の入口に運営の役割を送っても店として作られ、運営のアカウントを作る入口が無い", async () => {
    const r = await ctx.api().post("/api/register/store", { name: "なりすまし", email: "role@example.com", password: "store-pass-1234", role: "admin", humanToken: "tok-ok" });
    expect([200, 201, 400]).toContain(r.status);
    const account = await one(ctx.db, "SELECT role FROM accounts WHERE email = ?", "role@example.com");
    if (account) expect(account.role).toBe("store");
    const paths = ctx.app.routes.map((x: any) => `${x.method} ${x.path}`);
    expect(paths.filter((p: string) => /admin/.test(p) && /register|create|signup|account/.test(p))).toEqual([]);
    expect(paths.filter((p: string) => /^POST \/api\/register\//.test(p)).sort()).toEqual(["POST /api/register/customer", "POST /api/register/store"]);
  });
});

describeTask("25", "見える範囲（店の入口の全部・運営の入口の全部）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  const sampleBody = (path: string) => {
    if (/\/party$/.test(path)) return { party: 2 };
    if (/\/coupons(\/|$)/.test(path)) return { name: "x", note: "" };
    if (/\/profile$/.test(path)) return { name: "x", address: "x", url: null, genres: ["和食"], menus: [], budgetMin: 1000, budgetMax: 2000 };
    if (/\/offers$/.test(path)) return { couponIds: [], capacity: 1, partyMax: 2, until: "23:00" };
    if (/\/add$|\/reduce$/.test(path)) return { count: 1 };
    if (/party-max$/.test(path)) return { partyMax: 2 };
    if (/until$/.test(path)) return { until: "23:00" };
    if (/card\/confirm$/.test(path)) return { sessionId: "x" };
    if (/password$/.test(path)) return { password: "new-password-123" };
    return {};
  };
  const concrete = (path: string, ids: Record<string, string>) => path.replace(/:(\w+)/g, (_, k) => ids[k] ?? ids.id);

  it("14.5・14.6 店の入口の全部を別の店のセッションで叩き、読めず操作もできない（D1 が変わらない）", async () => {
    const scene = await receivedScene(ctx);
    const other = await approvedStore(ctx, { name: "べつの店" });
    const coupon = (await scene.store.api.post("/api/store/coupons", { name: "他店のクーポン", note: "" })).json.coupon;
    const ids = { id: scene.reservation.id };
    const storeRoutes = ctx.app.routes.filter((r: any) => r.auth === "store");
    expect(storeRoutes.length).toBeGreaterThan(10);
    for (const r of storeRoutes) {
      const path = concrete(r.path, /coupons\/:id$/.test(r.path) ? { id: coupon.id } : ids);
      const res = await (other.api as any)[r.method === "DELETE" ? "del" : r.method.toLowerCase()](path, r.method === "GET" ? undefined : sampleBody(path));
      const label = `${r.method} ${path}`;
      expect(res.text, label).not.toContain(scene.reservation.code);
      expect(res.text, label).not.toContain(scene.customer.api.cookie ?? "");
      if (/reservations|coupons\/:id/.test(r.path)) expect([403, 404, 409], label).toContain(res.status);
    }
    const stillActive = await one(ctx.db, "SELECT status FROM reservations WHERE id = ?", scene.reservation.id);
    expect(stillActive.status).toBe("active");
    expect(await one(ctx.db, "SELECT id FROM coupons WHERE id = ?", coupon.id)).toBeTruthy();
    expect((await scene.store.api.get("/api/store/home")).json.arrivals[0].code).toBe(scene.reservation.code);
  });

  it("14.7・14.9 運営の入口の全部を、店のセッションと未ログインで叩き、読めず操作もできない", async () => {
    const scene = await receivedScene(ctx);
    const adminRoutes = ctx.app.routes.filter((r: any) => r.auth === "admin");
    expect(adminRoutes.length).toBeGreaterThan(5);
    const before = await snapshot(ctx.db);
    for (const r of adminRoutes) {
      const path = concrete(r.path, { id: scene.store.id });
      for (const [api, expected] of [[scene.store.api, [403]], [ctx.api(), [401]]] as const) {
        const res = await (api as any)[r.method === "DELETE" ? "del" : r.method.toLowerCase()](path, r.method === "GET" ? undefined : sampleBody(path));
        expect(expected, `${r.method} ${path}`).toContain(res.status);
        expect(res.text).not.toContain(scene.store.email);
      }
    }
    expect(await snapshot(ctx.db)).toBe(before);
  });
});

describeTask("31", "【最終日】仮のパスワードとパスワードの変更", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
    await seedAdmin(ctx);
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("14.10〜14.16 発行→前のパスワードとセッションが効かない→仮のパスワードで入ると変更を求められる→決めると仮のパスワードが効かない。範囲の外は変わらない", async () => {
    const s = await registerStore(ctx, { email: "temp@example.com", password: "old-password-1" });
    const issued = await ctx.admin!.api.post(`/api/admin/stores/${s.id}/temp-password`, {});
    expect(issued.status).toBe(200);
    const temp: string = issued.json.tempPassword;
    expect(temp.length).toBeGreaterThanOrEqual(16);
    const issued2 = await ctx.admin!.api.post(`/api/admin/stores/${s.id}/temp-password`, {});
    expect(issued2.json.tempPassword).not.toBe(temp);
    const current: string = issued2.json.tempPassword;
    expect((await ctx.admin!.api.get(`/api/admin/stores/${s.id}`)).text).not.toContain(current);
    expect((await s.api.get("/api/store/home")).status).toBe(401);
    expect((await ctx.api().post("/api/auth/login", { email: "temp@example.com", password: "old-password-1", humanToken: "tok-ok" })).status).not.toBe(200);
    const login = await ctx.api().post("/api/auth/login", { email: "temp@example.com", password: current, humanToken: "tok-ok" });
    expect(login.status).toBe(200);
    expect(login.json.mustChangePassword).toBe(true);
    const api = ctx.api(cookieOf(login)!);
    expect((await api.get("/api/store/home")).json.mustChangePassword).toBe(true);
    const short = await api.post("/api/store/password", { password: "short" });
    expect(short.status).toBe(400);
    expect(short.json.error.fields.map((f: any) => f.name)).toContain("password");
    const changed = await api.post("/api/store/password", { password: "brand-new-password-9" });
    expect(changed.status).toBe(200);
    expect((await ctx.api().post("/api/auth/login", { email: "temp@example.com", password: current, humanToken: "tok-ok" })).status).not.toBe(200);
    const again = await ctx.api().post("/api/auth/login", { email: "temp@example.com", password: "brand-new-password-9", humanToken: "tok-ok" });
    expect(again.status).toBe(200);
    expect(again.json.mustChangePassword).toBe(false);
    expect((await rows(ctx.db, "SELECT password_hash FROM accounts WHERE email = ?", "temp@example.com"))[0].password_hash).not.toContain("brand-new-password-9");
  });
});
