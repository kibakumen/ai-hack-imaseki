// メールアドレスの確認の表への読み書き（2026-09-22 に枝 feat/email-verify で足し、2026-09-26 に取り込んだ・migration 0015）。
// 平文の token は置かず sha256 だけを置く（sessions と同じ置き方）。
// accounts の「確認した時刻」の列もここから触る（accounts.ts の既存の読み書きの形を変えないため）。

import type { Deps } from "../ports";
import { changedRows, type D1Result } from "./d1";

type Db = Deps["db"];

export type EmailVerificationRow = { tokenHash: string; accountId: string; email: string; expiresAtIso: string };

/** 同じアカウントの古い行を消してから1行置く（1つの文にまとめて流す）。 */
export const replaceEmailVerification = async (db: Db, row: EmailVerificationRow & { createdAtIso: string }): Promise<void> => {
  await db.batch([
    db.prepare(`DELETE FROM email_verifications WHERE account_id = ?1`).bind(row.accountId),
    db
      .prepare(`INSERT INTO email_verifications (token_hash, account_id, email, expires_at, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`)
      .bind(row.tokenHash, row.accountId, row.email, row.expiresAtIso, row.createdAtIso),
  ]);
};

export const findEmailVerificationByTokenHash = async (db: Db, tokenHash: string): Promise<EmailVerificationRow | null> => {
  const row = (await db.prepare(`SELECT token_hash, account_id, email, expires_at FROM email_verifications WHERE token_hash = ?1`).bind(tokenHash).first()) as Record<string, unknown> | null;
  return row ? { tokenHash: row.token_hash as string, accountId: row.account_id as string, email: row.email as string, expiresAtIso: row.expires_at as string } : null;
};

/**
 * 確認の成立を1つの文にまとめて書く: アカウントの確認した時刻を置き、使った行を消す。
 * ⚠️ アドレスが発行時と同じ行だけを更新する——リンクを開く前にアドレスを変えていたら、
 * 古いアドレスの確認で新しいアドレスが確認済みになってはいけない。
 */
export const markEmailVerified = async (db: Db, row: EmailVerificationRow, nowIso: string): Promise<boolean> => {
  const results = await db.batch([
    db.prepare(`UPDATE accounts SET email_verified_at = ?2 WHERE id = ?1 AND email = ?3`).bind(row.accountId, nowIso, row.email),
    db.prepare(`DELETE FROM email_verifications WHERE token_hash = ?1`).bind(row.tokenHash),
  ]);
  // 変わった行の判定は repo/d1 の changedRows 1つ（層の約束）。数が分からなければ「確認していない」側へ倒す。
  return changedRows(results[0] as D1Result<unknown> | undefined) > 0;
};

/** アカウントの「確認した時刻」。アカウントが無ければ null（呼ぶ側は「まだ確認していない」と同じに扱う）。 */
export const findEmailVerifiedAt = async (db: Db, accountId: string): Promise<string | null> => {
  const row = (await db.prepare(`SELECT email_verified_at FROM accounts WHERE id = ?1`).bind(accountId).first()) as Record<string, unknown> | null;
  return (row?.email_verified_at as string | null | undefined) ?? null;
};
