// メールアドレスの確認の入口（2026-09-22 に枝 feat/email-verify で足し、2026-09-26 に取り込んだ・本人選択）。
// 店と運営が「確認メールを送る」（POST）と、リンクを開いた人が「確認する」（GET・見分けなし）の3つ。
// 2026-09-26 に、運営のアカウントの画面が確認の状態を読む GET /api/admin/email/verify を足した（本人選択（AI提示））。
//
// ⚠️ 3つとも `deps.mailer` が無ければ 404 not_found（機能フラグ・defineRoute の `enabled`）——秘密 RESEND_API_KEY と
// MAIL_FROM を入れていない公開先・受け入れ検査の場面では、この入口は**無いのと同じ**に見える。
// `human` は付けない（受け入れ検査 d02 が人かどうかの確かめつきの入口の一覧を3つに固定している）。
// 送る2つは外へメールを出すので、連打の抑止の表（http/rateLimits）に載る（安全-03 の決まり）。

import type { Deps, Mailer } from "../../ports";
import { emailVerifyConfirmSchema, emailVerifySchema } from "../../schemas/account";
import { confirmEmailVerification, isEmailVerified, issueEmailVerification, type IssueEmailVerificationResult } from "../../usecases/emailVerification";
import { defineRoute, type RouteDefinition } from "../defineRoute";
import { notFound, refusal } from "../refusals";
import { respond } from "../respond";

const hasMailer = (deps: Deps): deps is Deps & { mailer: Mailer } => deps.mailer !== undefined;

/** どの欄の断りか。状態コードは語から決まる（email_mismatch は 400・mail_not_sent は 502）。 */
const refuse = (result: Extract<IssueEmailVerificationResult, { ok: false }>) =>
  result.kind === "email_mismatch"
    ? // 保存のアドレスと違う。どの欄かも返す（画面は欄の直下に出す）。
      refusal("email_mismatch", { fields: [{ name: "email", reason: "not_allowed" }] })
    : // 外へ送れなかった（Resend の断り・通信の失敗・打ち切り）。項目に帰せないので欄は返さない。
      refusal("mail_not_sent");

/** 確認のリンクの土台（要求の origin・設定を増やさない）。書き込みの入口なので Origin は見分けの前に確かめてある。 */
const originOf = (req: Request): string => new URL(req.url).origin;

// 2つの入口は別々に書く（連打の抑止の表の検査 rateLimits.test.ts が、defineRoute の path の文字列と手続きの呼び出しから、外へ出る入口を辿るため）。
const verifyStoreEmailRoute = defineRoute({
  method: "POST",
  path: "/api/store/email/verify",
  auth: "store",
  enabled: hasMailer,
  input: emailVerifySchema,
  handler: async ({ input, deps, req, ctx }) => {
    // 機能フラグを通っているので mailer は在る（型の上でだけ確かめ直す）。
    if (!hasMailer(deps)) return notFound();
    const result = await issueEmailVerification(deps, ctx.accountId, input, originOf(req));
    if (!result.ok) return refuse(result);
    return respond("POST /api/store/email/verify", { ok: true });
  },
});

const verifyAdminEmailRoute = defineRoute({
  method: "POST",
  path: "/api/admin/email/verify",
  auth: "admin",
  enabled: hasMailer,
  input: emailVerifySchema,
  handler: async ({ input, deps, req, ctx }) => {
    if (!hasMailer(deps)) return notFound();
    const result = await issueEmailVerification(deps, ctx.accountId, input, originOf(req));
    if (!result.ok) return refuse(result);
    return respond("POST /api/admin/email/verify", { ok: true });
  },
});

/**
 * 運営の確認の状態を読む（2026-09-26 本人選択（AI提示）: 運営のアカウントの画面にも、店のホームの帯と同じ確認の案内を置く）。
 * 店はホームの応答の `emailVerified` で読むが、運営にはそれに当たる読みの入口が無かったので足した（AI判断）。
 * 送る入口と同じく、口が無ければ 404（画面は帯を出さない）。読むだけで外へは送らないので、連打の抑止の表には載せない。
 */
const adminEmailStatusRoute = defineRoute({
  method: "GET",
  path: "/api/admin/email/verify",
  auth: "admin",
  enabled: hasMailer,
  handler: async ({ deps, ctx }) => respond("GET /api/admin/email/verify", { ok: true, verified: await isEmailVerified(deps, ctx.accountId) }),
});

const confirmEmailRoute = defineRoute({
  method: "GET",
  path: "/api/auth/verify-email",
  auth: "public",
  enabled: hasMailer,
  input: emailVerifyConfirmSchema,
  handler: async ({ input, deps }) => {
    // 期限切れ・無い・使用済みは同じ断り（在る無しを教えない）。
    if (!(await confirmEmailVerification(deps, input.token))) return refusal("verification_failed");
    return respond("GET /api/auth/verify-email", { ok: true });
  },
});

export const emailVerificationRoutes: RouteDefinition[] = [verifyStoreEmailRoute, verifyAdminEmailRoute, adminEmailStatusRoute, confirmEmailRoute];
