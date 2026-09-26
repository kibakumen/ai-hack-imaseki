// アカウントの編集の入口（2026-09-22 追加）: メールアドレスの変更（店・運営）と運営のパスワードの変更。
//
// 受け入れ検査（tests/acceptance/v2）には、この3つの入口を名指しで叩く場面が無い（受け入れ検査は 2026-09-25 から
// 本人の承認で書き換えられるが、ここで足した観点は単体の検査として持つ）。
// 全入口を横断する検査（r29 の壊れた入力・r14 の役割の越境）は新しい入口も自動で拾うが、
// この作業ツリーでは着手の記録が無いタスクのブロックが飛ぶので、同じ観点をここで固定する。
// 場面の準備は受け入れ検査と同じ偽物（_fakes）を使う。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cookieOf, makeCtx, registerStore, rows, seedAdmin, snapshot, type Ctx } from "../../../../tests/acceptance/v2/_fakes";
import { INPUT_REFUSAL_KINDS } from "../../domain/inputRefusal";
import { errorSchema } from "../../schemas/error";

let ctx: Ctx;

beforeAll(async () => {
  ctx = await makeCtx();
  await seedAdmin(ctx, { email: "unei@example.com", password: "admin-pass-1234" });
});

afterAll(async () => {
  await ctx.dispose();
});

const login = (email: string, password: string) => ctx.api().post("/api/auth/login", { email, password, humanToken: "tok-ok" });

describe("店のメールアドレスの変更 POST /api/store/email", () => {
  it("今のパスワードが合わなければ 403・password_mismatch で、何も変わらない", async () => {
    const s = await registerStore(ctx, { email: "mail-a@example.com", password: "store-pass-1234" });
    const before = await snapshot(ctx.db, { except: ["rate_counters", "sessions"] });
    const r = await s.api.post("/api/store/email", { email: "mail-a2@example.com", currentPassword: "wrong-password-1" });
    expect(r.status).toBe(403);
    expect(r.json.error.kind).toBe("password_mismatch");
    expect(r.json.error.fields.map((f: { name: string }) => f.name)).toEqual(["currentPassword"]);
    expect(await snapshot(ctx.db, { except: ["rate_counters", "sessions"] })).toBe(before);
  });

  it("ほかのアカウントのメールアドレス（大小の違いを含む）へは 409・email_taken", async () => {
    await registerStore(ctx, { email: "mail-taken@example.com" });
    const s = await registerStore(ctx, { email: "mail-b@example.com", password: "store-pass-1234" });
    const r = await s.api.post("/api/store/email", { email: "Mail-Taken@example.com", currentPassword: "store-pass-1234" });
    expect(r.status).toBe(409);
    expect(r.json.error.kind).toBe("email_taken");
    expect(r.json.error.fields.map((f: { name: string }) => f.name)).toEqual(["email"]);
    // 運営のアドレスも店と運営を通して1つ（基準 12.2）
    const r2 = await s.api.post("/api/store/email", { email: "unei@example.com", currentPassword: "store-pass-1234" });
    expect(r2.status).toBe(409);
  });

  it("合えば 200。前のアドレスでは入れず、新しいアドレスで入れる。今のセッションはそのまま使える", async () => {
    const s = await registerStore(ctx, { email: "mail-c@example.com", password: "store-pass-1234" });
    const r = await s.api.post("/api/store/email", { email: "mail-c-new@example.com", currentPassword: "store-pass-1234" });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ ok: true });
    expect((await s.api.get("/api/store/home")).status).toBe(200);
    expect((await login("mail-c@example.com", "store-pass-1234")).status).toBe(401);
    expect((await login("mail-c-new@example.com", "store-pass-1234")).status).toBe(200);
  });

  it("同じアドレスへの変更は何も起きず 200", async () => {
    const s = await registerStore(ctx, { email: "mail-d@example.com", password: "store-pass-1234" });
    const r = await s.api.post("/api/store/email", { email: "mail-d@example.com", currentPassword: "store-pass-1234" });
    expect(r.status).toBe(200);
  });

  // 2026-09-26 独立したレビューの指摘（AI判断）: 締め出しの数え（login:<アドレス>|…）と端末の印（loginDevice:<アドレス>|…）は
  // 鍵にメールアドレスを含む。アドレスを変えても前のアドレスの行が残り、あとで店が退会しても（退会は今のアドレスの行しか消さない）
  // 前のアドレスが表に残った。変えるときに、前のアドレスの2種の鍵を、アドレスの書き換えと同じまとまりで消す。
  const seedCounter = (key: string) => ctx.db.prepare("INSERT INTO rate_counters (key, window_start, count) VALUES (?1, ?2, 1)").bind(key, ctx.clock.now().toISOString()).run();
  const counterKeys = async (like: string) => (await rows<{ key: string }>(ctx.db, "SELECT key FROM rate_counters WHERE key LIKE ?1 ORDER BY key", like)).map((row) => row.key);

  it("別のアドレスへ変えたら、前のアドレスを鍵に含む数え（締め出しの数え・端末の印）を消す。ほかのアドレスの数えは残す", async () => {
    const s = await registerStore(ctx, { email: "mail-e@example.com", password: "store-pass-1234" });
    await seedCounter("login:mail-e@example.com|203.0.113.1");
    await seedCounter("loginDevice:mail-e@example.com|device-hash");
    await seedCounter("login:mail-e@example.com.other|203.0.113.1");
    await seedCounter("loginDevice:someone@example.com|device-hash");

    const r = await s.api.post("/api/store/email", { email: "mail-e-new@example.com", currentPassword: "store-pass-1234" });
    expect(r.status).toBe(200);
    expect(await counterKeys("login%:mail-e@example.com|%")).toEqual([]);
    expect(await counterKeys("login:mail-e@example.com.other|%")).toEqual(["login:mail-e@example.com.other|203.0.113.1"]);
    expect(await counterKeys("loginDevice:someone@example.com|%")).toEqual(["loginDevice:someone@example.com|device-hash"]);
  });

  it("同じアドレス（大小の違いだけを含む）への変更では、数えを消さない（端末の印を信じ続ける）", async () => {
    const s = await registerStore(ctx, { email: "mail-f@example.com", password: "store-pass-1234" });
    await seedCounter("loginDevice:mail-f@example.com|device-hash");
    const r = await s.api.post("/api/store/email", { email: "Mail-F@example.com", currentPassword: "store-pass-1234" });
    expect(r.status).toBe(200);
    expect(await counterKeys("loginDevice:mail-f@example.com|%")).toEqual(["loginDevice:mail-f@example.com|device-hash"]);
  });

  it("ほかのアカウントのアドレスで断られたら、前のアドレスの数えも残る（まとまりごと書かない）", async () => {
    await registerStore(ctx, { email: "mail-g-taken@example.com" });
    const s = await registerStore(ctx, { email: "mail-g@example.com", password: "store-pass-1234" });
    await seedCounter("loginDevice:mail-g@example.com|device-hash");
    const r = await s.api.post("/api/store/email", { email: "mail-g-taken@example.com", currentPassword: "store-pass-1234" });
    expect(r.status).toBe(409);
    expect(await counterKeys("loginDevice:mail-g@example.com|%")).toEqual(["loginDevice:mail-g@example.com|device-hash"]);
  });
});

describe("運営のメールアドレスとパスワードの変更", () => {
  it("POST /api/admin/password: 今のパスワードが合わなければ 403、新しい値が短ければ 400、合えば前の値で入れなくなる", async () => {
    const admin = ctx.admin!;
    const wrong = await admin.api.post("/api/admin/password", { currentPassword: "not-the-password", password: "brand-new-password-9" });
    expect(wrong.status).toBe(403);
    expect(wrong.json.error.kind).toBe("password_mismatch");
    const short = await admin.api.post("/api/admin/password", { currentPassword: "admin-pass-1234", password: "short" });
    expect(short.status).toBe(400);
    expect(short.json.error.fields.map((f: { name: string }) => f.name)).toContain("password");
    expect((await login("unei@example.com", "admin-pass-1234")).status).toBe(200);

    const ok = await admin.api.post("/api/admin/password", { currentPassword: "admin-pass-1234", password: "brand-new-password-9" });
    expect(ok.status).toBe(200);
    expect((await login("unei@example.com", "admin-pass-1234")).status).toBe(401);
    const again = await login("unei@example.com", "brand-new-password-9");
    expect(again.status).toBe(200);
    expect(again.json.role).toBe("admin");
    // 続きの検査のために、新しいパスワードのセッションへ乗り換える
    ctx.admin = { ...admin, cookie: cookieOf(again)!, api: ctx.api(cookieOf(again)!), password: "brand-new-password-9" };
  });

  it("POST /api/admin/email: 合えば新しいアドレスで運営として入れる", async () => {
    const admin = ctx.admin!;
    const r = await admin.api.post("/api/admin/email", { email: "unei-new@example.com", currentPassword: admin.password });
    expect(r.status).toBe(200);
    const again = await login("unei-new@example.com", admin.password);
    expect(again.status).toBe(200);
    expect(again.json.role).toBe("admin");
  });
});

describe("役割の越境と壊れた入力（r14・r29 と同じ観点）", () => {
  it("店のセッションで運営の入口は 403、未ログインは 401。運営のセッションで店の入口は 403", async () => {
    const s = await registerStore(ctx);
    const body = { email: "x@example.com", currentPassword: "store-pass-1234", password: "brand-new-password-9" };
    expect((await s.api.post("/api/admin/password", body)).status).toBe(403);
    expect((await s.api.post("/api/admin/email", body)).status).toBe(403);
    expect((await ctx.api().post("/api/admin/password", body)).status).toBe(401);
    expect((await ctx.api().post("/api/admin/email", body)).status).toBe(401);
    expect((await ctx.api().post("/api/store/email", body)).status).toBe(401);
    expect((await ctx.admin!.api.post("/api/store/email", body)).status).toBe(403);
  });

  it("型違い・欠け・JSON でない本文は 400 で、schemas/error の形・閉じた語・人が読む文が無く、D1 が変わらない", async () => {
    const s = await registerStore(ctx);
    const targets: Array<[string, typeof s.api]> = [
      ["/api/store/email", s.api],
      ["/api/admin/email", ctx.admin!.api],
      ["/api/admin/password", ctx.admin!.api],
    ];
    const before = await snapshot(ctx.db, { except: ["rate_counters"] });
    for (const [path, api] of targets) {
      const bodies: Array<{ label: string; body?: unknown; raw?: string }> = [
        { label: "型違い", body: { email: 5, password: [], currentPassword: {} } },
        { label: "欠け", body: {} },
        { label: "JSON でない", raw: "{ not json" },
      ];
      for (const b of bodies) {
        const res =
          b.raw !== undefined
            ? await api.raw(new Request(`https://app.test${path}`, { method: "POST", headers: { "content-type": "application/json", origin: "https://app.test", cookie: api.cookie ?? "" }, body: b.raw }))
            : await api.post(path, b.body);
        const label = `${path}（${b.label}）`;
        expect(res.status, label).toBe(400);
        expect(errorSchema.safeParse(res.json).success, `${label}: ${res.text}`).toBe(true);
        expect(INPUT_REFUSAL_KINDS, label).toContain(res.json.error.kind);
        expect(res.text, label).not.toMatch(/[ぁ-んァ-ン一-龠]/);
        if (b.raw === undefined) expect(res.json.error.fields.length, label).toBeGreaterThan(0);
      }
    }
    expect(await snapshot(ctx.db, { except: ["rate_counters"] })).toBe(before);
  });
});
