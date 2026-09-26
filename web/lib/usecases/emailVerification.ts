// メールアドレスの確認（2026-09-22 に枝 feat/email-verify で足し、2026-09-26 に取り込んだ・本人選択。要件14の基準 14.23〜14.28）。
//
// 3つの手続き: ①発行（確認のリンクをメールで送る）②確認（リンクの token を受けて確認済みにする）
// ③今の状態（確認済みかどうか）。**何もブロックしない**——ログイン・公開・変更のどれにも条件を足さない。
// 「まだ確認していない」を店の画面に見せるだけ。
//
// token は乱数（deps.rng）→ base64url（domain/token）で、表には sha256（deps.hasher）だけを置く。
// 平文は本文のリンクにだけ載せる（sessions と同じ置き方）。
// 手続きは断りの**種類だけ**を返す（状態コードへの対応は http/refusals の表・層の約束）。
// ⚠️ ①は `deps.mailer` が在る前提で呼ばれる（無ければ入口が 404 で止める）。

import { tokenFromBytes } from "../domain/token";
import { MAIL_TEXTS } from "../domain/texts";
import type { Deps, Mailer } from "../ports";
import { findAccountById } from "../repo/accounts";
import { findEmailVerificationByTokenHash, findEmailVerifiedAt, markEmailVerified, replaceEmailVerification } from "../repo/emailVerifications";
import type { EmailVerifyInput } from "../schemas/account";
import { EMAIL_VERIFY_TOKEN_BYTES, EMAIL_VERIFY_TTL_MS, MAIL_SEND_TIMEOUT_MS } from "../schemas/limits";
import { raceDeadline } from "./deadline";

export type IssueEmailVerificationResult = { ok: true } | { ok: false; kind: "email_mismatch" | "mail_not_sent" };

/** 確認のリンク。土台は要求の origin（設定を増やさない）。 */
export const verificationLink = (origin: string, token: string): string => `${origin}/verify-email?token=${encodeURIComponent(token)}`;

/**
 * 1通を外へ送る。打ち切り（MAIL_SEND_TIMEOUT_MS）は usecases/deadline の raceDeadline——答えない・投げた・断られた、の
 * どれでも「送れなかった」（設計-11: 外の呼び出しの打ち切りは1か所の競争で書く）。
 */
const sendMail = async (deps: Deps & { mailer: Mailer }, message: { to: string; subject: string; text: string }): Promise<boolean> => {
  const answer = await raceDeadline(MAIL_SEND_TIMEOUT_MS, deps.clock.after(MAIL_SEND_TIMEOUT_MS), (signal) => deps.mailer.send(message, { signal }));
  return answer.ok && answer.value.ok;
};

/**
 * ①発行。入れられたアドレスが保存と同じときだけ送る（別のアドレスへ送る道にしない・大小の違いは同じとみなす）。
 * 同じアカウントの古い行は消す（有効なリンクは常に最新の1本）。
 */
export const issueEmailVerification = async (deps: Deps & { mailer: Mailer }, accountId: string, input: EmailVerifyInput, origin: string): Promise<IssueEmailVerificationResult> => {
  const account = await findAccountById(deps.db, accountId);
  if (!account || account.email.toLowerCase() !== input.email.toLowerCase()) return { ok: false, kind: "email_mismatch" };

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
  if (!(await sendMail(deps, { to: account.email, subject: mail.subject, text: mail.text }))) return { ok: false, kind: "mail_not_sent" };
  return { ok: true };
};

/**
 * ②確認。token の sha256 で引き、期限内なら確認済みにして行を消す。
 * 期限切れ・無い token・使用済み・発行のあとにアドレスを変えた、は**同じ false**（在る無しを教えない）。
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
