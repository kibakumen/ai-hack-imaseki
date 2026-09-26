// 運営のアカウントの投入（2026-09-25 監査の指摘 安全-01）。
//
// 乗っ取られた運営を取り返す道として使えるかを見る:
//   - 投入の前に、今いる運営の一覧を返す（メールアドレスを変えられていても気づける）
//   - パスワードを入れ替えたアカウントのセッションは全部切る（乗っ取った側の画面を残さない）
//   - 番号を指して入れ替えれば、変えられたメールアドレスごと取り返せる（2人目の運営を作らない）
//   - 別の運営がいるのに黙って2人目を作らない（スクリプトはこの形で呼ぶ）

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cookieOf, makeCtx, one, rows, STORE_TERMS_AGREEMENT, type Ctx } from "../../../tests/acceptance/v2/_fakes";
import { OtherAdminsExistError, seedAdmin } from "./seedAdmin";

let ctx: Ctx;

beforeAll(async () => {
  ctx = await makeCtx();
});

afterAll(async () => {
  await ctx.dispose();
});

const login = (email: string, password: string) => ctx.api().post("/api/auth/login", { email, password, humanToken: "tok-ok" });
const adminCount = async () => (await rows(ctx.db, "SELECT id FROM accounts WHERE role = 'admin'")).length;

describe("seedAdmin", () => {
  it("初めての投入では運営を作り、それまでの運営の一覧は空", async () => {
    const result = await seedAdmin(ctx.deps, { email: "seed-a@example.com", password: "admin-pass-1234" });
    expect(result.created).toBe(true);
    expect(result.adminsBefore).toEqual([]);
    expect((await login("seed-a@example.com", "admin-pass-1234")).status).toBe(200);
  });

  it("同じメールアドレスで流し直すと、パスワードを入れ替えて、そのアカウントのセッションを全部切る", async () => {
    const intruder = ctx.api(cookieOf(await login("seed-a@example.com", "admin-pass-1234"))!);
    expect((await intruder.get("/api/admin/stores")).status).toBe(200);
    const result = await seedAdmin(ctx.deps, { email: "seed-a@example.com", password: "rotated-pass-5678" });
    expect(result.created).toBe(false);
    expect(result.adminsBefore.map((a) => a.email)).toEqual(["seed-a@example.com"]);
    expect((await intruder.get("/api/admin/stores")).status).toBe(401);
    expect((await login("seed-a@example.com", "admin-pass-1234")).status).not.toBe(200);
    expect((await login("seed-a@example.com", "rotated-pass-5678")).status).toBe(200);
  });

  it("メールアドレスを変えられた運営は、番号を指して取り返せる（2人目を作らず、乗っ取った側のセッションも切る）", async () => {
    // 乗っ取った側がメールアドレスとパスワードを変えた、という場面
    const hijacker = ctx.api(cookieOf(await login("seed-a@example.com", "rotated-pass-5678"))!);
    expect((await hijacker.post("/api/admin/email", { email: "attacker@example.com", currentPassword: "rotated-pass-5678" })).status).toBe(200);
    const target = await one<{ id: string }>(ctx.db, "SELECT id FROM accounts WHERE email = ?", "attacker@example.com");

    const before = await adminCount();
    const result = await seedAdmin(ctx.deps, { email: "seed-a@example.com", password: "reclaimed-pass-9", accountId: target!.id });
    expect(result).toMatchObject({ accountId: target!.id, created: false });
    expect(result.adminsBefore.map((a) => a.email)).toContain("attacker@example.com");
    expect(await adminCount()).toBe(before);
    expect((await hijacker.get("/api/admin/stores")).status).toBe(401);
    expect((await login("attacker@example.com", "rotated-pass-5678")).status).not.toBe(200);
    expect((await login("seed-a@example.com", "reclaimed-pass-9")).status).toBe(200);
  });

  it("別の運営がいるのに2人目を足さない指定なら、何も書かずに一覧つきで断る", async () => {
    const before = await adminCount();
    await expect(seedAdmin(ctx.deps, { email: "seed-b@example.com", password: "admin-pass-1234", allowAnotherAdmin: false })).rejects.toBeInstanceOf(OtherAdminsExistError);
    try {
      await seedAdmin(ctx.deps, { email: "seed-b@example.com", password: "admin-pass-1234", allowAnotherAdmin: false });
    } catch (error) {
      expect((error as OtherAdminsExistError).admins.map((a) => a.email)).toEqual(["seed-a@example.com"]);
    }
    expect(await adminCount()).toBe(before);
    // 同じメールアドレスの入れ替えは、この指定でも通る（2人目にはならない）
    expect((await seedAdmin(ctx.deps, { email: "seed-a@example.com", password: "reclaimed-pass-9", allowAnotherAdmin: false })).created).toBe(false);
  });

  it("店のアカウントは運営に変えない（メールアドレスでも番号でも）", async () => {
    const store = await ctx.api().post("/api/register/store", { name: "店", email: "seed-store@example.com", password: "store-pass-1234", humanToken: "tok-ok", ...STORE_TERMS_AGREEMENT });
    expect([200, 201]).toContain(store.status);
    const account = await one<{ id: string }>(ctx.db, "SELECT id FROM accounts WHERE email = ?", "seed-store@example.com");
    await expect(seedAdmin(ctx.deps, { email: "seed-store@example.com", password: "admin-pass-1234" })).rejects.toThrow();
    await expect(seedAdmin(ctx.deps, { email: "seed-c@example.com", password: "admin-pass-1234", accountId: account!.id })).rejects.toThrow();
    expect((await one<{ role: string }>(ctx.db, "SELECT role FROM accounts WHERE id = ?", account!.id))!.role).toBe("store");
  });

  // 2026-09-26 独立したレビューの指摘（AI判断）: 番号を指してメールアドレスを差し替えても「確認した時刻」（migration 0015）が
  // 残り、確認していない新しいアドレスが確認済みに見えた。アドレスが変わるときだけ、同じ文で NULL に戻す。
  it("番号を指して別のアドレスへ差し替えたら、メールアドレスの確認は未確認に戻る。同じアドレス（大小の違いだけ）なら確認済みのまま", async () => {
    const created = await seedAdmin(ctx.deps, { email: "seed-v@example.com", password: "admin-pass-1234" });
    const verifiedAt = "2026-09-20T00:00:00.000Z";
    await ctx.db.prepare("UPDATE accounts SET email_verified_at = ?2 WHERE id = ?1").bind(created.accountId, verifiedAt).run();
    const verifiedOf = async () => (await one<{ email: string; email_verified_at: string | null }>(ctx.db, "SELECT email, email_verified_at FROM accounts WHERE id = ?", created.accountId))!;

    await seedAdmin(ctx.deps, { email: "Seed-V@example.com", password: "admin-pass-5678", accountId: created.accountId });
    expect(await verifiedOf()).toEqual({ email: "Seed-V@example.com", email_verified_at: verifiedAt });

    await seedAdmin(ctx.deps, { email: "seed-v2@example.com", password: "admin-pass-9012", accountId: created.accountId });
    expect(await verifiedOf()).toEqual({ email: "seed-v2@example.com", email_verified_at: null });
  });

  it("番号を指したとき、そのメールアドレスが別のアカウントに使われていれば断る", async () => {
    const target = await one<{ id: string }>(ctx.db, "SELECT id FROM accounts WHERE email = ?", "seed-a@example.com");
    await expect(seedAdmin(ctx.deps, { email: "seed-store@example.com", password: "admin-pass-1234", accountId: target!.id })).rejects.toThrow();
  });
});
