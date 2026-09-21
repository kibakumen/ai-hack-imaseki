// sessions の表への読み書き（設計書「データと状態」: token_hash・account_id・expires_at）。
// Cookie に配るのは乱数の値で、表に置くのはその SHA-256 だけ。時刻は ISO 8601 の文字列で、
// 比較は必ず呼ぶ側が束縛した「今」で行う（SQLite の datetime('now') は使わない・実行者への契約）。

import type { Deps } from "../ports";
import type { AccountRole } from "./accounts";

type Db = Deps["db"];

export type NewSession = { tokenHash: string; accountId: string; expiresAtIso: string };

export type SessionRow = {
  tokenHash: string;
  accountId: string;
  role: AccountRole;
  storeId: string | null;
  mustChangePassword: boolean;
  /** 壊れた値（日付に読めない文字列）も、そのまま呼ぶ側へ渡す——期限切れの判定は呼ぶ側が行う */
  expiresAtIso: string;
};

const INSERT_SESSION = `INSERT INTO sessions (token_hash, account_id, expires_at) VALUES (?1, ?2, ?3)`;

/** 1つの文にまとめて流すための文（店の登録は店・アカウント・セッションを1度に書く）。 */
export const insertSessionStatement = (db: Db, session: NewSession) =>
  db.prepare(INSERT_SESSION).bind(session.tokenHash, session.accountId, session.expiresAtIso);

export const insertSession = async (db: Db, session: NewSession): Promise<void> => {
  await insertSessionStatement(db, session).run();
};

/** セッションと、その持ち主のアカウントを1度に引く。無ければ null。 */
export const findSessionByTokenHash = async (db: Db, tokenHash: string): Promise<SessionRow | null> => {
  const row = await db
    .prepare(
      `SELECT sessions.expires_at AS expires_at, accounts.id AS account_id, accounts.role AS role,
              accounts.store_id AS store_id, accounts.must_change_password AS must_change_password
       FROM sessions JOIN accounts ON accounts.id = sessions.account_id
       WHERE sessions.token_hash = ?1`,
    )
    .bind(tokenHash)
    .first();
  if (!row) return null;
  return {
    tokenHash,
    accountId: row.account_id as string,
    role: row.role as AccountRole,
    storeId: (row.store_id as string | null) ?? null,
    mustChangePassword: Number(row.must_change_password ?? 0) === 1,
    expiresAtIso: String(row.expires_at ?? ""),
  };
};

/** 期限を延ばす（スライディングウィンドウ・要件14）。値そのものは呼ぶ側が「今」から決める。 */
export const extendSession = async (db: Db, tokenHash: string, expiresAtIso: string): Promise<void> => {
  await db.prepare(`UPDATE sessions SET expires_at = ?2 WHERE token_hash = ?1`).bind(tokenHash, expiresAtIso).run();
};

export const deleteSession = async (db: Db, tokenHash: string): Promise<void> => {
  await db.prepare(`DELETE FROM sessions WHERE token_hash = ?1`).bind(tokenHash).run();
};

/**
 * そのアカウントのセッションを全部切る（【最終日】仮のパスワードの発行・要件14の基準 14.12）。
 * パスワードを取り替えるだけでは、既に開いている画面はそのまま使えてしまう。
 */
export const deleteSessionsByAccount = async (db: Db, accountId: string): Promise<void> => {
  await db.prepare(`DELETE FROM sessions WHERE account_id = ?1`).bind(accountId).run();
};
