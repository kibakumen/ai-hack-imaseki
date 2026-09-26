// メールアドレスの確認の入口（2026-09-22 に枝 feat/email-verify で足し、2026-09-26 に取り込んだ・要件14の基準 14.23〜14.28）。
//
// 受け入れ検査（tests/acceptance/v2）の場面は既定でメールを送る口を持たない（鍵を入れていない公開先と同じ）。
// 全部の入口を横断する受け入れ検査（r29 の壊れた入力・r14 の役割の越境・d03 の Origin）はこの入口も自動で拾う。
// ここでは口の**無い**場面と**在る**場面の両方で、この機能に固有の約束を見る。
// 場面の道具は受け入れ検査と同じ（_fakes の makeCtx・registerStore・seedAdmin）。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeCtx, registerStore, seedAdmin, snapshot, type Ctx, type CtxWith } from "../../../../tests/acceptance/v2/_fakes";
import { INPUT_REFUSAL_KINDS } from "../../domain/inputRefusal";
import type { MailMessage, Mailer } from "../../ports";
import { errorSchema } from "../../schemas/error";
import { EMAIL_VERIFY_RATE_LIMIT, EMAIL_VERIFY_TTL_MS, MAIL_SEND_TIMEOUT_MS } from "../../schemas/limits";
import { RESPONSES } from "../../schemas/responses";

type FakeMailer = Mailer & { sent: MailMessage[]; result: { ok: true } | { ok: false } | "hang" | "throw"; signals: Array<AbortSignal | undefined> };
const fakeMailer = (): FakeMailer => {
  const m: FakeMailer = {
    sent: [],
    signals: [],
    result: { ok: true },
    send: async (message, opts) => {
      m.sent.push(message);
      m.signals.push(opts.signal);
      if (m.result === "throw") throw new TypeError("Failed to fetch");
      if (m.result === "hang") return new Promise(() => {});
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

describe("メールを送る口が無い（受け入れ検査の既定・鍵を入れていない公開先）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
    await seedAdmin(ctx, { email: "unei@example.com", password: "admin-pass-1234" });
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("3つの入口はどれも 404 not_found で、経路が無いのと同じ形。店のホームに emailVerified が無く、D1 は変わらない", async () => {
    const s = await registerStore(ctx, { email: "nomail@example.com" });
    const before = await snapshot(ctx.db, { except: ["rate_counters", "sessions"] });
    for (const r of [
      await s.api.post("/api/store/email/verify", { email: "nomail@example.com" }),
      await ctx.admin!.api.post("/api/admin/email/verify", { email: "unei@example.com" }),
      await ctx.api().get("/api/auth/verify-email?token=abc"),
    ]) {
      expect(r.status).toBe(404);
      expect(r.json).toEqual({ ok: false, error: { kind: "not_found" } });
    }
    const home = await s.api.get("/api/store/home");
    expect(home.status).toBe(200);
    expect("emailVerified" in home.json).toBe(false);
    expect(await snapshot(ctx.db, { except: ["rate_counters", "sessions"] })).toBe(before);
  });

  // 2026-09-26 本人選択（AI提示）: 運営のアカウントの画面にも確認の案内を置く。確認の状態を読む入口も、口が無ければ 404（画面に帯が出ない）
  it("運営の確認の状態を読む入口（GET /api/admin/email/verify）も 404 not_found", async () => {
    const r = await ctx.admin!.api.get("/api/admin/email/verify");
    expect(r.status).toBe(404);
    expect(r.json).toEqual({ ok: false, error: { kind: "not_found" } });
  });

  it("口が無い入口への要求は、連打の抑止の数を減らさない（数える前に 404）", async () => {
    const s = await registerStore(ctx);
    for (let i = 0; i < EMAIL_VERIFY_RATE_LIMIT + 1; i++) expect((await s.api.post("/api/store/email/verify", { email: s.email })).status).toBe(404);
    const counters = await ctx.db.prepare("SELECT key FROM rate_counters WHERE key LIKE 'emailVerify%'").all();
    expect(counters.results).toEqual([]);
  });

  it("見分けと壊れた入力は 404 より先（未ログイン 401・役割違い 403・型違い 400）——ほかの入口と同じ見え方", async () => {
    const s = await registerStore(ctx);
    expect((await ctx.api().post("/api/store/email/verify", { email: "x@example.com" })).json.error.kind).toBe("unauthenticated");
    expect((await s.api.post("/api/admin/email/verify", { email: "x@example.com" })).status).toBe(403);
    expect((await ctx.admin!.api.post("/api/store/email/verify", { email: "x@example.com" })).status).toBe(403);
    const broken = await s.api.post("/api/store/email/verify", { email: 5 });
    expect(broken.status).toBe(400);
    expect(broken.json.error.kind).toBe("invalid_input");
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
  let ctx: CtxWith<{ mailer: FakeMailer }>;
  let mailer: FakeMailer;
  beforeAll(async () => {
    mailer = fakeMailer();
    ctx = await makeCtx({ deps: { mailer } });
    await seedAdmin(ctx, { email: "unei@example.com", password: "admin-pass-1234" });
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("店のホームに emailVerified:false が出る。送る→リンクを開く→true。表には平文の token が無い。応答は形の表どおり", async () => {
    const s = await registerStore(ctx, { email: "verify-a@example.com" });
    const home = await s.api.get("/api/store/home");
    expect(home.json.emailVerified).toBe(false);
    expect(RESPONSES["GET /api/store/home"].safeParse(home.json).success).toBe(true);

    const sent = await s.api.post("/api/store/email/verify", { email: "Verify-A@example.com" });
    expect(sent.status).toBe(200);
    expect(sent.json).toEqual({ ok: true });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0].to).toBe("verify-a@example.com");
    expect(mailer.sent[0].subject).toContain("イマセキ");
    // 外への呼び出しには打ち切りの合図を渡す（設計-11）
    expect(mailer.signals[0]).toBeInstanceOf(AbortSignal);
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

  it("保存と違うアドレスへは送らない（400・email_mismatch・email の欄）。送れなかったら 502・mail_not_sent", async () => {
    const s = await registerStore(ctx, { email: "verify-b@example.com" });
    const sentBefore = mailer.sent.length;
    const wrong = await s.api.post("/api/store/email/verify", { email: "someone-else@example.com" });
    expect(wrong.status).toBe(400);
    expect(wrong.json.error.kind).toBe("email_mismatch");
    expect(wrong.json.error.fields.map((f: { name: string }) => f.name)).toEqual(["email"]);
    expect(mailer.sent.length).toBe(sentBefore);

    for (const result of [{ ok: false } as const, "throw" as const]) {
      mailer.result = result;
      const failed = await s.api.post("/api/store/email/verify", { email: "verify-b@example.com" });
      mailer.result = { ok: true };
      expect(failed.status, String(result)).toBe(502);
      expect(failed.json.error.kind).toBe("mail_not_sent");
      expect(errorSchema.safeParse(failed.json).success).toBe(true);
    }
  });

  it("Resend が答えなければ、打ち切り（MAIL_SEND_TIMEOUT_MS）で 502・mail_not_sent を返し、止まり続けない", async () => {
    const s = await registerStore(ctx, { email: "verify-hang@example.com" });
    mailer.result = "hang";
    const armed = ctx.clock.armed(1);
    const pending = s.api.post("/api/store/email/verify", { email: "verify-hang@example.com" });
    await armed;
    await ctx.clock.advance(MAIL_SEND_TIMEOUT_MS + 1);
    const r = await pending;
    mailer.result = { ok: true };
    expect(r.status).toBe(502);
    expect(r.json.error.kind).toBe("mail_not_sent");
    expect(mailer.signals.at(-1)?.aborted).toBe(true);
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

  it("確認したあとにメールアドレスを変えると「まだ確認していない」に戻る。同じアドレス（大小の違いだけ）への変更では戻らない", async () => {
    const s = await registerStore(ctx, { email: "verify-d@example.com", password: "store-pass-1234" });
    await s.api.post("/api/store/email/verify", { email: "verify-d@example.com" });
    await ctx.api().get(`/api/auth/verify-email?token=${encodeURIComponent(tokenIn(mailer.sent.at(-1)!))}`);
    expect((await s.api.get("/api/store/home")).json.emailVerified).toBe(true);
    expect((await s.api.post("/api/store/email", { email: "Verify-D@example.com", currentPassword: "store-pass-1234" })).status).toBe(200);
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

  it("運営の確認の状態を読む入口は、確認する前は verified:false・リンクを開いたあとは true。店のセッションは 403・未ログインは 401。応答は形の表どおり", async () => {
    const admin = ctx.admin!;
    // 前の検査がアドレスを変えていることがあるので、今のアドレスを表から読む（変えたあとは未確認に戻っている）
    const { email } = await ctx.db.prepare("SELECT email FROM accounts WHERE role = 'admin' LIMIT 1").first();
    const before = await admin.api.get("/api/admin/email/verify");
    expect(before.status).toBe(200);
    expect(before.json).toEqual({ ok: true, verified: false });
    expect(RESPONSES["GET /api/admin/email/verify"].safeParse(before.json).success).toBe(true);
    mailer.result = { ok: true };
    const sentBefore = mailer.sent.length;
    expect((await admin.api.post("/api/admin/email/verify", { email })).status).toBe(200);
    const token = tokenIn(mailer.sent[sentBefore]);
    expect((await ctx.api().get(`/api/auth/verify-email?token=${encodeURIComponent(token)}`)).status).toBe(200);
    expect((await admin.api.get("/api/admin/email/verify")).json).toEqual({ ok: true, verified: true });
    const s = await registerStore(ctx);
    expect((await s.api.get("/api/admin/email/verify")).status).toBe(403);
    expect((await ctx.api().get("/api/admin/email/verify")).status).toBe(401);
  });

  it("確認メールの送り直しは、同じアカウントで1時間に上限まで。次は 429 で、外へは送らない", async () => {
    const s = await registerStore(ctx, { email: "verify-rate@example.com" });
    for (let i = 0; i < EMAIL_VERIFY_RATE_LIMIT; i++) expect((await s.api.post("/api/store/email/verify", { email: "verify-rate@example.com" })).status, String(i)).toBe(200);
    const sentBefore = mailer.sent.length;
    const over = await s.api.post("/api/store/email/verify", { email: "verify-rate@example.com" });
    expect(over.status).toBe(429);
    expect(over.json.error.kind).toBe("rate_limited");
    expect(mailer.sent.length).toBe(sentBefore);
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
