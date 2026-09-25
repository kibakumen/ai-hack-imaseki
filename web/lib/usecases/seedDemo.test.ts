// デモの種データの投入（2026-09-25 監査の指摘 安全-01 のレビュー）。
//
// デモを作り直す道（web/scripts/seed-demo.mjs・docs/dummy-data.md が案内している）が、乗っ取られたデモを
// 取り返す道として使えるかを見る:
//   - 別のメールアドレスの運営がいれば、既定では2人目を作らずに何も書かずに止まる（運営の投入 seed-admin と揃える）
//   - 番号を指せば、メールアドレスを変えられた運営を取り返せる
//   - 既にある店のアカウントは、パスワードを入れ替えてセッションを全部切る。止められた店は承認済みへ戻す
//
// それまでは運営の投入を既定のまま（2人目を作ってよい）呼び、既にある店のパスワードに触れなかった。
// しかもスクリプトは、repo から消えた関数を呼んでいて動かなかった（型の検査を通らない .mjs に判断を置いていたため）。

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cookieOf, makeCtx, one, rows, snapshot, type Ctx } from "../../../tests/acceptance/v2/_fakes";
import { hashPassword } from "./credentials";
import { OtherAdminsExistError } from "./seedAdmin";
import { rotateDemoStorePasswords, seedDemo, type DemoStoreSpec, type SeedDemoInput } from "./seedDemo";

const STORE: DemoStoreSpec = {
  email: "demo-a@example.com",
  name: "喫茶 検査文庫",
  address: "東京都千代田区神田駿河台4-3",
  lat: 35.699211,
  lng: 139.76819,
  genres: ["カフェ・バー"],
  menus: ["ブレンドコーヒー", "ナポリタン"],
  budgetMin: 700,
  budgetMax: 1300,
  offer: { capacity: 3, partyMax: 2 },
  coupons: [
    { name: "ブレンドコーヒー1杯無料", note: "" },
    { name: "プリン無料", note: "1組1つまで" },
  ],
};

const ADMIN = { email: "demo-admin@example.com", password: "admin-pass-1234" };
const STORE_PASSWORD = "store-pass-1234";

const input = (over: Partial<SeedDemoInput> = {}): SeedDemoInput => ({ admin: ADMIN, storePassword: STORE_PASSWORD, stores: [STORE], ...over });

let ctx: Ctx;

beforeEach(async () => {
  ctx = await makeCtx();
});

afterEach(async () => {
  await ctx.dispose();
});

const login = (email: string, password: string) => ctx.api().post("/api/auth/login", { email, password, humanToken: "tok-ok" });
const count = async (sql: string, ...params: unknown[]) => (await rows(ctx.db, sql, ...params)).length;
const storeAccount = async () => (await one<{ id: string; store_id: string; must_change_password: number }>(ctx.db, "SELECT id, store_id, must_change_password FROM accounts WHERE email = ?", STORE.email))!;

describe("seedDemo", () => {
  it("空の D1 に、運営・承認済みの店・クーポン・公開中のオファーを入れ、店は決めたパスワードで入れる", async () => {
    const result = await seedDemo(ctx.deps, input());

    expect(result.admin).toMatchObject({ created: true, adminsBefore: [] });
    expect(result.stores).toEqual([expect.objectContaining({ email: STORE.email, created: true, couponCount: 2, offerInserted: true })]);
    const account = await storeAccount();
    expect((await one<{ status: string }>(ctx.db, "SELECT status FROM stores WHERE id = ?", account.store_id))!.status).toBe("approved");
    expect(await count("SELECT id FROM coupons WHERE store_id = ?", account.store_id)).toBe(2);
    expect(await count("SELECT id FROM offers WHERE store_id = ?", account.store_id)).toBe(1);
    expect((await login(STORE.email, STORE_PASSWORD)).status).toBe(200);
    expect((await login(ADMIN.email, ADMIN.password)).status).toBe(200);
  });

  it("流し直しても、店・運営・クーポン・公開中のオファーを二重に作らない", async () => {
    await seedDemo(ctx.deps, input());
    const result = await seedDemo(ctx.deps, input());

    expect(result.admin.created).toBe(false);
    expect(result.stores).toEqual([expect.objectContaining({ created: false, couponCount: 2, offerInserted: false })]);
    expect(await count("SELECT id FROM accounts")).toBe(2);
    expect(await count("SELECT id FROM stores")).toBe(1);
    expect(await count("SELECT id FROM coupons")).toBe(2);
    expect(await count("SELECT id FROM offers")).toBe(1);
  });

  it("別のメールアドレスの運営がいれば、既定では2人目の運営を作らず、何も書かずに一覧つきで止まる", async () => {
    await seedDemo(ctx.deps, input());
    // 乗っ取った側が、運営のメールアドレスを変えた
    const hijacker = ctx.api(cookieOf(await login(ADMIN.email, ADMIN.password))!);
    expect((await hijacker.post("/api/admin/email", { email: "attacker@example.com", currentPassword: ADMIN.password })).status).toBe(200);

    const before = await snapshot(ctx.db);
    const run = seedDemo(ctx.deps, input());
    await expect(run).rejects.toBeInstanceOf(OtherAdminsExistError);
    await expect(run).rejects.toMatchObject({ admins: [expect.objectContaining({ email: "attacker@example.com" })] });
    expect(await snapshot(ctx.db)).toBe(before);
  });

  it("運営の番号を指せば、メールアドレスを変えられた運営を取り返し、乗っ取った側のセッションを切る", async () => {
    await seedDemo(ctx.deps, input());
    const hijacker = ctx.api(cookieOf(await login(ADMIN.email, ADMIN.password))!);
    expect((await hijacker.post("/api/admin/email", { email: "attacker@example.com", currentPassword: ADMIN.password })).status).toBe(200);
    const target = (await one<{ id: string }>(ctx.db, "SELECT id FROM accounts WHERE email = ?", "attacker@example.com"))!;

    const result = await seedDemo(ctx.deps, input({ admin: { ...ADMIN, password: "reclaimed-pass-9", accountId: target.id } }));

    expect(result.admin).toMatchObject({ accountId: target.id, created: false });
    expect(await count("SELECT id FROM accounts WHERE role = 'admin'")).toBe(1);
    expect((await hijacker.get("/api/admin/stores")).status).toBe(401);
    expect((await login(ADMIN.email, "reclaimed-pass-9")).status).toBe(200);
  });

  it("既にある店のアカウントは、パスワードを入れ替えてセッションを全部切り、仮のパスワードの印を外し、止められた店を承認済みへ戻す", async () => {
    await seedDemo(ctx.deps, input());
    const account = await storeAccount();
    // 乗っ取った運営が、デモ店に仮のパスワードを発行して入り、店を止めた
    const attackerHash = await hashPassword(ctx.deps, "attacker-pass-99");
    await ctx.db.prepare("UPDATE accounts SET password_hash = ?1, must_change_password = 1 WHERE id = ?2").bind(attackerHash, account.id).run();
    expect((await login(STORE.email, "attacker-pass-99")).status).toBe(200);
    await ctx.db.prepare("UPDATE stores SET status = 'banned' WHERE id = ?1").bind(account.store_id).run();
    await ctx.db.prepare("UPDATE offers SET ended_at = ?2, end_reason = 'banned' WHERE store_id = ?1").bind(account.store_id, ctx.deps.clock.now().toISOString()).run();
    expect(await count("SELECT token_hash FROM sessions WHERE account_id = ?", account.id)).toBeGreaterThan(0);

    const result = await seedDemo(ctx.deps, input());

    expect(result.stores).toEqual([expect.objectContaining({ created: false, offerInserted: true })]);
    expect(await count("SELECT token_hash FROM sessions WHERE account_id = ?", account.id)).toBe(0);
    expect((await storeAccount()).must_change_password).toBe(0);
    expect((await login(STORE.email, "attacker-pass-99")).status).not.toBe(200);
    expect((await login(STORE.email, STORE_PASSWORD)).status).toBe(200);
    expect((await one<{ status: string }>(ctx.db, "SELECT status FROM stores WHERE id = ?", account.store_id))!.status).toBe("approved");
  });

  // 2026-09-25 安全-20 のレビュー: 運営の画面で止めると許可書と承認の写しが消え、戻すと承認待ちになる。種の入れ直しは
  // デモの店を承認済みへ戻す道なので、承認待ちに戻った店はそのまま承認し直す（デモの店は許可書を持たない）。
  it("運営の画面で止めた（承認の写しが消えた）デモの店も、種を入れ直すと承認済みへ戻る", async () => {
    await seedDemo(ctx.deps, input());
    const account = await storeAccount();
    await ctx.db
      .prepare("UPDATE stores SET status = 'banned', approved_at = NULL, approved_name = NULL, approved_address = NULL, approved_license_key = NULL WHERE id = ?1")
      .bind(account.store_id)
      .run();

    await seedDemo(ctx.deps, input());

    expect((await one<{ status: string }>(ctx.db, "SELECT status FROM stores WHERE id = ?", account.store_id))!.status).toBe("approved");
  });

  it("店のメールアドレスが運営のアカウントに使われていれば、店に変えずに断る", async () => {
    const run = seedDemo(ctx.deps, input({ stores: [{ ...STORE, email: ADMIN.email }] }));
    await expect(run).rejects.toThrow(/店のアカウントに使われていません/);
    expect((await one<{ role: string }>(ctx.db, "SELECT role FROM accounts WHERE email = ?", ADMIN.email))!.role).toBe("admin");
  });
});

// 本番のデモ店のパスワードの入れ替え（README 5.3・2026-09-26 のレビュー）。seed-demo.mjs の --rotate-stores の中身。
describe("rotateDemoStorePasswords", () => {
  it("指したデモ店だけのパスワードを入れ替えて仮のパスワードの印を外し、そのセッションを全部切る。運営と店の中身には触れない", async () => {
    await seedDemo(ctx.deps, input());
    const storeSession = ctx.api(cookieOf(await login(STORE.email, STORE_PASSWORD))!);
    const adminSession = ctx.api(cookieOf(await login(ADMIN.email, ADMIN.password))!);
    await ctx.db.prepare("UPDATE accounts SET must_change_password = 1 WHERE email = ?1").bind(STORE.email).run();
    const storesBefore = await rows(ctx.db, "SELECT * FROM stores");

    await rotateDemoStorePasswords(ctx.deps, { storePassword: "rotated-pass-5678", emails: [STORE.email, ADMIN.email] });

    expect((await storeSession.get("/api/store/home")).status).toBe(401);
    expect((await login(STORE.email, STORE_PASSWORD)).status).not.toBe(200);
    const relogin = await login(STORE.email, "rotated-pass-5678");
    expect(relogin.status).toBe(200);
    expect(relogin.json.mustChangePassword).toBe(false);
    // 運営のアドレスを混ぜても、役割が店の行しか書き換えない
    expect((await adminSession.get("/api/admin/stores")).status).toBe(200);
    expect((await login(ADMIN.email, ADMIN.password)).status).toBe(200);
    expect(await rows(ctx.db, "SELECT * FROM stores")).toEqual(storesBefore);
  });

  it("ログインの入口が断る短さのパスワードには入れ替えない（何も書かない）", async () => {
    await seedDemo(ctx.deps, input());
    const before = await snapshot(ctx.db);
    await expect(rotateDemoStorePasswords(ctx.deps, { storePassword: "short", emails: [STORE.email] })).rejects.toThrow();
    expect(await snapshot(ctx.db)).toBe(before);
  });
});
