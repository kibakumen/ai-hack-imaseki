// メールアドレスの確認（2026-09-22 追加・feat/email-verify）。
//
// 3つの手続き: ①発行（確認のリンクをメールで送る）②確認（リンクの token を受けて確認済みにする）
// ③今の状態（確認済みかどうか）。**何もブロックしない**——ログイン・公開・変更のどれにも条件を足さない。
// 「まだ確認していない」を店の画面に見せるだけ。
//
// token は乱数（deps.rng）→ base64url（domain/token）で、表には sha256（deps.hasher）だけを置く。
// 平文は本文のリンクにだけ載せる（sessions と同じ置き方）。
// ⚠️ この手続きは `deps.mailer` が在る前提で呼ばれる（無ければ入口が 404 で止める）。

import { tokenFromBytes } from "../domain/token";
import { MAIL_TEXTS } from "../domain/texts";
import type { Deps, Mailer } from "../ports";
import { findAccountById } from "../repo/accounts";
import { findEmailVerificationByTokenHash, findEmailVerifiedAt, markEmailVerified, replaceEmailVerification } from "../repo/emailVerifications";
import type { EmailVerifyInput } from "../schemas/account";
import { EMAIL_VERIFY_TOKEN_BYTES, EMAIL_VERIFY_TTL_MS } from "../schemas/limits";

export type IssueEmailVerificationResult = { ok: true } | { ok: false; kind: "invalid_input" | "mail_not_sent" };

/** 確認のリンクの土台。要求の origin から作る（設定を増やさない）。 */
export const verificationLink = (origin: string, token: string): string => `${origin}/verify-email?token=${encodeURIComponent(token)}`;

/**
 * ①発行。入れられたアドレスが保存と同じときだけ送る（別のアドレスへ送る道にしない・大小の違いは同じとみなす）。
 * 同じアカウントの古い行は消す（有効なリンクは常に最新の1本）。
 */
export const issueEmailVerification = async (deps: Deps & { mailer: Mailer }, accountId: string, input: EmailVerifyInput, origin: string): Promise<IssueEmailVerificationResult> => {
  const account = await findAccountById(deps.db, accountId);
  if (!account || account.email.toLowerCase() !== input.email.toLowerCase()) return { ok: false, kind: "invalid_input" };

  const token = tokenFromBytes(deps.rng.bytes(EMAIL_VERIFY_TOKEN_BYTES));
  const tokenHash = await deps.hasher.sha256Hex(token);
  const now = deps.clock.now();
  await replaceEmailVerification(deps.db, {
    tokenHash,
    accountId: account.id,
    email: account.email,
    expiresAtIso: new Date(now.getTime() + EMAIL_VERIFY_TTL_MS).toISOString(),
    createdAtIso: now.toISOString(),
  });

  const mail = MAIL_TEXTS.emailVerification(verificationLink(origin, token));
  const sent = await deps.mailer.send({ to: account.email, subject: mail.subject, text: mail.text }, {});
  if (!sent.ok) return { ok: false, kind: "mail_not_sent" };
  return { ok: true };
};

/**
 * ②確認。token の sha256 で引き、期限内なら確認済みにして行を消す。
 * 期限切れ・無い token・使用済みは**同じ false**（在る無しを教えない）。
 */
export const confirmEmailVerification = async (deps: Deps, token: string): Promise<boolean> => {
  const row = await findEmailVerificationByTokenHash(deps.db, await deps.hasher.sha256Hex(token));
  if (!row) return false;
  const now = deps.clock.now();
  const expiresAt = new Date(row.expiresAtIso).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return false;
  return markEmailVerified(deps.db, row, now.toISOString());
};

/** ③今の状態。確認した時刻が在れば true。 */
export const isEmailVerified = async (deps: Deps, accountId: string): Promise<boolean> => (await findEmailVerifiedAt(deps.db, accountId)) !== null;
