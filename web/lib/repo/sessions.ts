// sessions の表への読み書き（設計書「データと状態」: token_hash・account_id・expires_at・created_at）。
// created_at は絶対の寿命（安全-08）を数える起点で、migration 0008 で足した。それより前の行は NULL。
// Cookie に配るのは乱数の値で、表に置くのはその SHA-256 だけ。時刻は ISO 8601 の文字列で、
// 比較は必ず呼ぶ側が束縛した「今」で行う（SQLite の datetime('now') は使わない・実行者への契約）。

import type { Deps } from "../ports";
import type { AccountRole } from "./accounts";
import type { D1PreparedStatement } from "./d1";

type Db = Deps["db"];

export type NewSession = { tokenHash: string; accountId: string; expiresAtIso: string; createdAtIso: string };

export type SessionRow = {
  tokenHash: string;
  accountId: string;
  role: AccountRole;
  storeId: string | null;
  mustChangePassword: boolean;
  /** 壊れた値（日付に読めない文字列）も、そのまま呼ぶ側へ渡す——期限切れの判定は呼ぶ側が行う */
  expiresAtIso: string;
  /** 作った時刻。0008 より前の行は空の文字列（呼ぶ側が切れたものとして断る） */
  createdAtIso: string;
};

const INSERT_SESSION = `INSERT INTO sessions (token_hash, account_id, expires_at, created_at) VALUES (?1, ?2, ?3, ?4)`;

/** 1つの文にまとめて流すための文（店の登録は店・アカウント・セッションを1度に書く）。 */
export const insertSessionStatement = (db: Db, session: NewSession) =>
  db.prepare(INSERT_SESSION).bind(session.tokenHash, session.accountId, session.expiresAtIso, session.createdAtIso);

export const insertSession = async (db: Db, session: NewSession): Promise<void> => {
  await insertSessionStatement(db, session).run();
};

/** セッションと、その持ち主のアカウントを1度に引く。無ければ null。 */
export const findSessionByTokenHash = async (db: Db, tokenHash: string): Promise<SessionRow | null> => {
  const row = await db
    .prepare(
      `SELECT sessions.expires_at AS expires_at, sessions.created_at AS created_at, accounts.id AS account_id, accounts.role AS role,
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
    createdAtIso: String(row.created_at ?? ""),
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
  await deleteSessionsByAccountStatement(db, accountId).run();
};

/**
 * そのアカウントのセッションのうち、今の1本（`keepTokenHash`）以外を全部切る（2026-09-25 監査の指摘 安全-08）。
 * パスワードとメールアドレスの変更が通ったときに呼ぶ——乗っ取りに気づいて変えた持ち主の画面は残し、
 * 相手の端末や置き忘れた端末のセッションだけを止める。
 */
export const deleteOtherSessionsOfAccount = async (db: Db, accountId: string, keepTokenHash: string): Promise<void> => {
  await db.prepare(`DELETE FROM sessions WHERE account_id = ?1 AND token_hash <> ?2`).bind(accountId, keepTokenHash).run();
};

/**
 * メールアドレスで指した店のアカウントのセッションを全部切る（デモ店の鍵の入れ替え・README 5.3・2026-09-26 のレビュー）。
 * 読み取りを挟まない1文なので、`--print` で本番へ貼る文にそのままなる。
 */
export const deleteSessionsOfStoreAccountsByEmail = async (db: Db, emails: readonly string[]): Promise<void> => {
  const placeholders = emails.map((_, i) => `?${i + 1}`).join(", ");
  await db.prepare(`DELETE FROM sessions WHERE account_id IN (SELECT id FROM accounts WHERE role = 'store' AND email IN (${placeholders}))`).bind(...emails).run();
};

/** そのアカウントのセッションを全部切る文（流さずに返す・仮のパスワードの発行が `db.batch` に入れる）。 */
export const deleteSessionsByAccountStatement = (db: Db, accountId: string): D1PreparedStatement =>
  db.prepare(`DELETE FROM sessions WHERE account_id = ?1`).bind(accountId);
