// メールアドレスの確認の入口（2026-09-22 追加・feat/email-verify）。
// 店と運営が「確認メールを送る」（POST）と、リンクを開いた人が「確認する」（GET・見分けなし）の3つ。
//
// ⚠️ 3つとも `deps.mailer` が無ければ 404（機能フラグ・defineRoute の `enabled`）——秘密 RESEND_API_KEY と
// MAIL_FROM を入れていない公開先・受け入れ検査の場面では、この入口は**無いのと同じ**に見える。
// `human: true` は付けない（受け入れ検査 d02 が human の入口の一覧を3つに固定している）。

import { z } from "zod";
import type { Deps, Mailer } from "../../ports";
import { emailVerifySchema } from "../../schemas/account";
import { EMAIL_VERIFY_TOKEN_MAX_LENGTH } from "../../schemas/limits";
import { confirmEmailVerification, issueEmailVerification, type IssueEmailVerificationResult } from "../../usecases/emailVerification";
import { defineRoute, type RouteDefinition } from "../defineRoute";

const hasMailer = (deps: Deps): deps is Deps & { mailer: Mailer } => deps.mailer !== undefined;

const refuse = (result: Extract<IssueEmailVerificationResult, { ok: false }>) =>
  result.kind === "invalid_input"
    ? // 保存のアドレスと違う。どの欄かも返す（画面は欄の直下に出す）。
      { status: 400, body: { ok: false, error: { kind: result.kind, fields: [{ name: "email", reason: "not_allowed" as const }] } } }
    : // 外へ送れなかった（Resend の断り・通信の失敗）。項目に帰せないので欄は返さない。
      { status: 502, body: { ok: false, error: { kind: result.kind } } };

/** 店と運営で同じ手続き。見分けだけが違う（endpoints/email と同じ作り）。 */
const issueRoute = (path: string, auth: "store" | "admin") =>
  defineRoute({
    method: "POST",
    path,
    auth,
    enabled: hasMailer,
    input: emailVerifySchema,
    handler: async ({ input, deps, req, ctx }) => {
      // 機能フラグを通っているので mailer は在る（型の上でだけ確かめ直す）。
      if (!hasMailer(deps)) return { status: 404, body: { ok: false, error: { kind: "invalid_input" } } };
      // 確認のリンクの土台は要求の origin から作る（設定を増やさない）。
      const result = await issueEmailVerification(deps, ctx.accountId, input, new URL(req.url).origin);
      if (!result.ok) return refuse(result);
      return { status: 200, body: { ok: true } };
    },
  });

const verifyStoreEmailRoute = issueRoute("/api/store/email/verify", "store");
const verifyAdminEmailRoute = issueRoute("/api/admin/email/verify", "admin");

/** リンクの token。長すぎる値は早く切る（実際の値は16バイトの base64url＝22字）。 */
const confirmSchema = z.object({ token: z.string().min(1).max(EMAIL_VERIFY_TOKEN_MAX_LENGTH) });

const confirmEmailRoute = defineRoute({
  method: "GET",
  path: "/api/auth/verify-email",
  auth: "public",
  enabled: hasMailer,
  input: confirmSchema,
  handler: async ({ input, deps }) => {
    const ok = await confirmEmailVerification(deps, input.token);
    // 期限切れ・無い・使用済みは同じ断り（在る無しを教えない）。
    if (!ok) return { status: 400, body: { ok: false, error: { kind: "verification_failed" } } };
    return { status: 200, body: { ok: true } };
  },
});

export const emailVerificationRoutes: RouteDefinition[] = [verifyStoreEmailRoute, verifyAdminEmailRoute, confirmEmailRoute];
