// accounts の表への読み書き（設計書「ファイル構成の計画」: lib/repo は D1 の SQL）。
// パスワードは元に戻せない形の1つの文字列（domain/password.ts が組む値）としてだけ置く（基準 14.4）。
// メールアドレスの列は COLLATE NOCASE なので、= の比較が大文字小文字を区別しない（基準 12.2）。

import type { Deps } from "../ports";

type Db = Deps["db"];

export type AccountRole = "store" | "admin";

export type AccountRow = {
  id: string;
  email: string;
  role: AccountRole;
  storeId: string | null;
  passwordHash: string;
  mustChangePassword: boolean;
};

export type NewAccount = {
  id: string;
  email: string;
  role: AccountRole;
  /** 運営のアカウントは店を持たない（null） */
  storeId: string | null;
  passwordHash: string;
};

const INSERT_ACCOUNT = `INSERT INTO accounts (id, email, password_hash, role, store_id) VALUES (?1, ?2, ?3, ?4, ?5)`;

const toRow = (row: Record<string, unknown> | null): AccountRow | null =>
  row
    ? {
        id: row.id as string,
        email: row.email as string,
        role: row.role as AccountRole,
        storeId: (row.store_id as string | null) ?? null,
        passwordHash: row.password_hash as string,
        mustChangePassword: Number(row.must_change_password ?? 0) === 1,
      }
    : null;

/** 店と運営を通して1件だけ（メールアドレスは表の UNIQUE で1つに保たれる）。無ければ null。 */
export const findAccountByEmail = async (db: Db, email: string): Promise<AccountRow | null> => {
  const row = await db.prepare(`SELECT id, email, password_hash, role, store_id, must_change_password FROM accounts WHERE email = ?1`).bind(email).first();
  return toRow(row as Record<string, unknown> | null);
};

/** 1つの文にまとめて流すための文（店の登録は店・アカウント・セッションを1度に書く）。 */
export const insertAccountStatement = (db: Db, account: NewAccount) =>
  db.prepare(INSERT_ACCOUNT).bind(account.id, account.email, account.passwordHash, account.role, account.storeId);

export const insertAccount = async (db: Db, account: NewAccount): Promise<void> => {
  await insertAccountStatement(db, account).run();
};

/**
 * パスワードだけを置き換える。種データの投入のやり直し（同じメールアドレス）と、
 * 【最終日】仮のパスワードの発行・店が決め直した新しいパスワードが呼ぶ。
 *
 * `mustChangePassword` を立てると、次に入った店は新しいパスワードを決めるよう求められる
 * （要件14の基準 14.14）。決め直したときは false に戻す（基準 14.16）。
 */
export const updateAccountPassword = async (db: Db, accountId: string, passwordHash: string, mustChangePassword = false): Promise<void> => {
  await db
    .prepare(`UPDATE accounts SET password_hash = ?2, must_change_password = ?3 WHERE id = ?1`)
    .bind(accountId, passwordHash, mustChangePassword ? 1 : 0)
    .run();
};

/**
 * 店の番号からその店のアカウントを引く（【最終日】仮のパスワードの発行）。
 * 役割が店のものだけを見る——運営のアカウントは対象にしない（要件14の基準 14.8・14.10 の補足）。
 */
export const findAccountByStoreId = async (db: Db, storeId: string): Promise<AccountRow | null> => {
  const row = await db
    .prepare(`SELECT id, email, password_hash, role, store_id, must_change_password FROM accounts WHERE store_id = ?1 AND role = 'store'`)
    .bind(storeId)
    .first();
  return toRow(row as Record<string, unknown> | null);
};
