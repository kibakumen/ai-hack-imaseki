// メールアドレスの確認の入口（2026-09-22 追加・feat/email-verify）。
//
// 受け入れ検査（tests/acceptance/v2）は凍結されていて、この入口を名指しで叩く場面が無い。
// 全入口を横断する検査（r29 の壊れた入力・r14 の役割の越境）は新しい入口も自動で拾うが、
// この作業ツリーでは着手の記録が無いタスクのブロックが飛ぶので、同じ観点をここで固定する。
// 場面は2つ——メールを送る口が**無い**（受け入れ検査と同じ・入口は 404 で無いのと同じ）と、**在る**。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeCtx, registerStore, seedAdmin, snapshot, type Ctx } from "../../../../tests/acceptance/v2/_fakes";
import { INPUT_REFUSAL_KINDS } from "../../domain/inputRefusal";
import type { MailMessage, Mailer } from "../../ports";
import { errorSchema } from "../../schemas/error";
import { EMAIL_VERIFY_TTL_MS } from "../../schemas/limits";

type FakeMailer = Mailer & { sent: MailMessage[]; result: { ok: true } | { ok: false } };
const fakeMailer = (): FakeMailer => {
  const m: FakeMailer = {
    sent: [],
    result: { ok: true },
    send: async (message) => {
      m.sent.push(message);
      return m.result;
    },
  };
  return m;
};

/** 本文のリンクから token を取る（平文は本文にだけ載る） */
const tokenIn = (message: MailMessage): string => {
  const link = message.text.split("\n").find((line) => line.startsWith("https://"));
  if (!link) throw new Error(`本文にリンクが無い: ${message.text}`);
  const url = new URL(link);
  expect(url.pathname).toBe("/verify-email");
  return url.searchParams.get("token") ?? "";
};

describe("メールを送る口が無い（受け入れ検査と同じ場面）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
    await seedAdmin(ctx, { email: "unei@example.com", password: "admin-pass-1234" });
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("3つの入口はどれも 404 で、経路が無いのと同じ形。店のホームに emailVerified が無い", async () => {
    const s = await registerStore(ctx, { email: "nomail@example.com" });
    const before = await snapshot(ctx.db, { except: ["rate_counters", "sessions"] });
    for (const r of [
      await s.api.post("/api/store/email/verify", { email: "nomail@example.com" }),
      await ctx.admin!.api.post("/api/admin/email/verify", { email: "unei@example.com" }),
      await ctx.api().get("/api/auth/verify-email?token=abc"),
    ]) {
      expect(r.status).toBe(404);
      expect(r.json).toEqual({ ok: false, error: { kind: "invalid_input" } });
    }
    const home = await s.api.get("/api/store/home");
    expect(home.status).toBe(200);
    expect("emailVerified" in home.json).toBe(false);
    expect(await snapshot(ctx.db, { except: ["rate_counters", "sessions"] })).toBe(before);
  });

  it("見分けは 404 より先（未ログイン 401・役割違い 403）——ほかの入口と同じ見え方", async () => {
    const s = await registerStore(ctx);
    expect((await ctx.api().post("/api/store/email/verify", { email: "x@example.com" })).status).toBe(401);
    expect((await s.api.post("/api/admin/email/verify", { email: "x@example.com" })).status).toBe(403);
    expect((await ctx.admin!.api.post("/api/store/email/verify", { email: "x@example.com" })).status).toBe(403);
  });

  it("メールアドレスの変更は口の有無にかかわらず通る（確認した時刻の列は NULL のまま）", async () => {
    const s = await registerStore(ctx, { email: "chg@example.com", password: "store-pass-1234" });
    const r = await s.api.post("/api/store/email", { email: "chg2@example.com", currentPassword: "store-pass-1234" });
    expect(r.status).toBe(200);
    const acc = await ctx.db.prepare("SELECT email_verified_at FROM accounts WHERE email = ?1").bind("chg2@example.com").first();
    expect(acc.email_verified_at).toBeNull();
  });
});

describe("メールを送る口が在る", () => {
  let ctx: Ctx;
  let mailer: FakeMailer;
  beforeAll(async () => {
    mailer = fakeMailer();
    // 受け入れ検査の契約 `_types.Deps` は mailer を知らない（凍結）ので、型だけ緩めて渡す
    ctx = await makeCtx({ deps: { mailer } as unknown as NonNullable<Parameters<typeof makeCtx>[0]>["deps"] });
    await seedAdmin(ctx, { email: "unei@example.com", password: "admin-pass-1234" });
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("店のホームに emailVerified:false が出る。送る→リンクを開く→true。表には平文の token が無い", async () => {
    const s = await registerStore(ctx, { email: "verify-a@example.com" });
    expect((await s.api.get("/api/store/home")).json.emailVerified).toBe(false);

    const sent = await s.api.post("/api/store/email/verify", { email: "Verify-A@example.com" });
    expect(sent.status).toBe(200);
    expect(sent.json).toEqual({ ok: true });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe("verify-a@example.com");
    const token = tokenIn(mailer.sent[0]);
    expect(token.length).toBeGreaterThan(16);
    const rows = await ctx.db.prepare("SELECT token_hash, email FROM email_verifications").all();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].token_hash).not.toBe(token);
    expect(JSON.stringify(rows.results)).not.toContain(token);

    const confirmed = await ctx.api().get(`/api/auth/verify-email?token=${encodeURIComponent(token)}`);
    expect(confirmed.status).toBe(200);
    expect(confirmed.json).toEqual({ ok: true });
    expect((await s.api.get("/api/store/home")).json.emailVerified).toBe(true);
    // 使った行は消え、同じリンクは2度目は通らない（在る無しを教えない同じ断り）
    expect((await ctx.db.prepare("SELECT count(*) AS n FROM email_verifications").first()).n).toBe(0);
    const again = await ctx.api().get(`/api/auth/verify-email?token=${encodeURIComponent(token)}`);
    expect(again.status).toBe(400);
    expect(again.json.error.kind).toBe("verification_failed");
  });

  it("保存と違うアドレスへは送らない（400・email の欄）。送れなかったら 502・mail_not_sent", async () => {
    const s = await registerStore(ctx, { email: "verify-b@example.com" });
    const sentBefore = mailer.sent.length;
    const wrong = await s.api.post("/api/store/email/verify", { email: "someone-else@example.com" });
    expect(wrong.status).toBe(400);
    expect(wrong.json.error.kind).toBe("invalid_input");
    expect(wrong.json.error.fields.map((f: { name: string }) => f.name)).toEqual(["email"]);
    expect(mailer.sent.length).toBe(sentBefore);

    mailer.result = { ok: false };
    const failed = await s.api.post("/api/store/email/verify", { email: "verify-b@example.com" });
    mailer.result = { ok: true };
    expect(failed.status).toBe(502);
    expect(failed.json.error.kind).toBe("mail_not_sent");
    expect(errorSchema.safeParse(failed.json).success).toBe(true);
  });

  it("期限（24時間）を過ぎたリンクは通らず、無い token と同じ断り。送り直すと古いリンクは消える", async () => {
    const s = await registerStore(ctx, { email: "verify-c@example.com" });
    await s.api.post("/api/store/email/verify", { email: "verify-c@example.com" });
    const first = tokenIn(mailer.sent.at(-1)!);
    await s.api.post("/api/store/email/verify", { email: "verify-c@example.com" });
    const second = tokenIn(mailer.sent.at(-1)!);
    expect(second).not.toBe(first);
    expect((await ctx.api().get(`/api/auth/verify-email?token=${encodeURIComponent(first)}`)).status).toBe(400);

    await ctx.clock.advance(EMAIL_VERIFY_TTL_MS + 1);
    const expired = await ctx.api().get(`/api/auth/verify-email?token=${encodeURIComponent(second)}`);
    expect(expired.status).toBe(400);
    expect(expired.json.error.kind).toBe("verification_failed");
    const missing = await ctx.api().get("/api/auth/verify-email?token=no-such-token");
    expect(missing.status).toBe(400);
    expect(missing.json).toEqual(expired.json);
    expect((await s.api.get("/api/store/home")).json.emailVerified).toBe(false);
  });

  it("確認したあとにメールアドレスを変えると、また「まだ確認していない」に戻る", async () => {
    const s = await registerStore(ctx, { email: "verify-d@example.com", password: "store-pass-1234" });
    await s.api.post("/api/store/email/verify", { email: "verify-d@example.com" });
    await ctx.api().get(`/api/auth/verify-email?token=${encodeURIComponent(tokenIn(mailer.sent.at(-1)!))}`);
    expect((await s.api.get("/api/store/home")).json.emailVerified).toBe(true);
    expect((await s.api.post("/api/store/email", { email: "verify-d2@example.com", currentPassword: "store-pass-1234" })).status).toBe(200);
    expect((await s.api.get("/api/store/home")).json.emailVerified).toBe(false);
  });

  it("運営の入口も同じ手続き。リンクを開く前にアドレスを変えていたら、古いリンクでは確認済みにならない", async () => {
    const admin = ctx.admin!;
    const r = await admin.api.post("/api/admin/email/verify", { email: "unei@example.com" });
    expect(r.status).toBe(200);
    const token = tokenIn(mailer.sent.at(-1)!);
    expect((await admin.api.post("/api/admin/email", { email: "unei-2@example.com", currentPassword: "admin-pass-1234" })).status).toBe(200);
    expect((await ctx.api().get(`/api/auth/verify-email?token=${encodeURIComponent(token)}`)).status).toBe(400);
    const acc = await ctx.db.prepare("SELECT email_verified_at FROM accounts WHERE email = ?1").bind("unei-2@example.com").first();
    expect(acc.email_verified_at).toBeNull();
  });

  it("型違い・欠け・JSON でない本文は 400 で、schemas/error の形・閉じた語・人が読む文が無く、D1 が変わらない（r29 と同じ観点）", async () => {
    const s = await registerStore(ctx);
    const targets: Array<[string, typeof s.api]> = [
      ["/api/store/email/verify", s.api],
      ["/api/admin/email/verify", ctx.admin!.api],
    ];
    const before = await snapshot(ctx.db, { except: ["rate_counters"] });
    for (const [path, api] of targets) {
      const bodies: Array<{ label: string; body?: unknown; raw?: string }> = [
        { label: "型違い", body: { email: 5 } },
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
    const noToken = await ctx.api().get("/api/auth/verify-email");
    expect(noToken.status).toBe(400);
    expect(errorSchema.safeParse(noToken.json).success).toBe(true);
    expect(await snapshot(ctx.db, { except: ["rate_counters"] })).toBe(before);
  });
});
