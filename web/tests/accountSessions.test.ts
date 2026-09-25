// 店と運営のアカウントの守り（2026-09-25 監査の指摘 安全-07・安全-08・安全-21）。
//
// 受け入れ検査 r14 の3本（ほかの端末のセッション・今のパスワード・仮のパスワードのままの利用）が
// 本筋を見る。ここは、その3本が触れない縁を固定する:
//   - メールアドレスの変更でも、ほかの端末のセッションが切れる（安全-08）
//   - 店のパスワードの変更の断りの形（今のパスワードが無い 400／合わない 403）と、合えば通ること（安全-07）
//   - 仮のパスワードのまま入った店が使える入口の範囲と、決め直した後に戻ること（安全-21）
//   - セッションの絶対の寿命（使い続けても14日で切れる）と、作った時刻の無い古い行の扱い（安全-08）

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cookieOf, makeCtx, one, registerStore, seedAdmin, type Ctx } from "../../tests/acceptance/v2/_fakes";
import { SESSION_ABSOLUTE_MAX_SECONDS, SESSION_MAX_AGE_SECONDS } from "../lib/schemas/limits";

let ctx: Ctx;

beforeAll(async () => {
  ctx = await makeCtx();
  await seedAdmin(ctx, { email: "unei-sessions@example.com", password: "admin-pass-1234" });
});

afterAll(async () => {
  await ctx.dispose();
});

const login = (email: string, password: string) => ctx.api().post("/api/auth/login", { email, password, humanToken: "tok-ok" });
const HOUR_MS = 60 * 60 * 1000;

describe("メールアドレスの変更でも、ほかの端末のセッションが切れる（安全-08）", () => {
  it("店: 変えた端末は続けて使え、ほかの端末は 401 になる", async () => {
    const s = await registerStore(ctx, { email: "sess-mail@example.com", password: "store-pass-1234" });
    const other = ctx.api(cookieOf(await login("sess-mail@example.com", "store-pass-1234"))!);
    expect((await other.get("/api/store/home")).status).toBe(200);
    const r = await s.api.post("/api/store/email", { email: "sess-mail-2@example.com", currentPassword: "store-pass-1234" });
    expect(r.status).toBe(200);
    expect((await s.api.get("/api/store/home")).status).toBe(200);
    expect((await other.get("/api/store/home")).status).toBe(401);
  });

  it("運営: 同じく、ほかの端末は 401 になる。断られた変更（今のパスワード違い）ではセッションに触れない", async () => {
    const admin = await seedAdmin(ctx, { email: "unei-mail@example.com", password: "admin-pass-1234" });
    const other = ctx.api(cookieOf(await login("unei-mail@example.com", "admin-pass-1234"))!);
    const refused = await admin.api.post("/api/admin/email", { email: "unei-mail-2@example.com", currentPassword: "wrong-password-1" });
    expect(refused.status).toBe(403);
    expect((await other.get("/api/admin/stores")).status).toBe(200);
    const ok = await admin.api.post("/api/admin/email", { email: "unei-mail-2@example.com", currentPassword: "admin-pass-1234" });
    expect(ok.status).toBe(200);
    expect((await admin.api.get("/api/admin/stores")).status).toBe(200);
    expect((await other.get("/api/admin/stores")).status).toBe(401);
  });
});

describe("店のパスワードの変更は、仮のパスワードの直後でなければ今のパスワードを求める（安全-07）", () => {
  it("今のパスワードが無ければ 400（欄は currentPassword）、合わなければ 403・password_mismatch で、どちらも何も変わらない", async () => {
    const s = await registerStore(ctx, { email: "sess-pass-a@example.com", password: "store-pass-1234" });
    const missing = await s.api.post("/api/store/password", { password: "brand-new-password-9" });
    expect(missing.status).toBe(400);
    expect(missing.json.error.fields).toEqual([{ name: "currentPassword", reason: "required" }]);
    const wrong = await s.api.post("/api/store/password", { currentPassword: "wrong-password-1", password: "brand-new-password-9" });
    expect(wrong.status).toBe(403);
    expect(wrong.json.error.kind).toBe("password_mismatch");
    expect((await login("sess-pass-a@example.com", "store-pass-1234")).status).toBe(200);
    expect((await login("sess-pass-a@example.com", "brand-new-password-9")).status).not.toBe(200);
  });

  it("合えば変わり、ほかの端末のセッションは切れて、変えた端末は続けて使える", async () => {
    const s = await registerStore(ctx, { email: "sess-pass-b@example.com", password: "store-pass-1234" });
    const other = ctx.api(cookieOf(await login("sess-pass-b@example.com", "store-pass-1234"))!);
    const r = await s.api.post("/api/store/password", { currentPassword: "store-pass-1234", password: "brand-new-password-9" });
    expect(r.status).toBe(200);
    expect((await s.api.get("/api/store/home")).status).toBe(200);
    expect((await other.get("/api/store/home")).status).toBe(401);
    expect((await login("sess-pass-b@example.com", "brand-new-password-9")).status).toBe(200);
  });
});

describe("仮のパスワードのまま入った店が使える入口（安全-21）", () => {
  it("ホーム・パスワードの変更・ログアウトは使え、ほかは 403。決め直すと、ほかの入口も使える", async () => {
    const s = await registerStore(ctx, { email: "sess-temp@example.com", password: "old-password-1" });
    const issued = await ctx.admin!.api.post(`/api/admin/stores/${s.id}/temp-password`, {});
    const temp = await login("sess-temp@example.com", issued.json.tempPassword);
    const api = ctx.api(cookieOf(temp)!);
    expect((await api.get("/api/store/home")).status).toBe(200);
    expect((await api.post("/api/store/email", { email: "x-temp@example.com", currentPassword: issued.json.tempPassword })).status).toBe(403);
    expect((await api.post("/api/store/coupons", { name: "生ビール1杯", note: "" })).status).toBe(403);
    // 仮のパスワードの直後は、今のパスワードを求めない（覚えていない場面・基準 14.14）
    expect((await api.post("/api/store/password", { password: "brand-new-password-9" })).status).toBe(200);
    expect((await api.get("/api/store/results")).status).toBe(200);
    expect((await api.post("/api/auth/logout", {})).status).toBe(200);
    expect((await api.get("/api/store/home")).status).toBe(401);
  });
});

describe("セッションの絶対の寿命（安全-08）", () => {
  it("使い続けて延ばしても、作ってから14日で切れる（延ばす先も14日を越えない）", async () => {
    await registerStore(ctx, { email: "sess-life@example.com", password: "store-pass-1234" });
    const api = ctx.api(cookieOf(await login("sess-life@example.com", "store-pass-1234"))!);
    const started = ctx.clock.now().getTime();
    const step = SESSION_MAX_AGE_SECONDS * 1000 - HOUR_MS / 2; // 残りが1時間を切った所で使う＝毎回延びる
    let at = started;
    while (at + step < started + SESSION_ABSOLUTE_MAX_SECONDS * 1000) {
      at += step;
      ctx.clock.set(new Date(at).toISOString());
      expect((await api.get("/api/store/home")).status, new Date(at).toISOString()).toBe(200);
    }
    ctx.clock.set(new Date(started + SESSION_ABSOLUTE_MAX_SECONDS * 1000).toISOString());
    expect((await api.get("/api/store/home")).status).toBe(401);
  });

  it("作った時刻の無い行（0008 より前に作られたセッション）は、期限の内でも切れたものとして断る", async () => {
    const s = await registerStore(ctx, { email: "sess-old@example.com", password: "store-pass-1234" });
    expect((await s.api.get("/api/store/home")).status).toBe(200);
    const account = await one<{ id: string }>(ctx.db, "SELECT id FROM accounts WHERE email = ?", "sess-old@example.com");
    await ctx.db.prepare("UPDATE sessions SET created_at = NULL WHERE account_id = ?1").bind(account!.id).run();
    expect((await s.api.get("/api/store/home")).status).toBe(401);
  });
});
