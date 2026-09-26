// accounts の表への読み書き（設計書「ファイル構成の計画」: lib/repo は D1 の SQL）。
// パスワードは元に戻せない形の1つの文字列（domain/password.ts が組む値）としてだけ置く（基準 14.4）。
// メールアドレスの列は COLLATE NOCASE なので、= の比較が大文字小文字を区別しない（基準 12.2）。

import { normalizeLoginEmail } from "../domain/loginDevice";
import type { Deps } from "../ports";
import type { D1PreparedStatement } from "./d1";
import { emailCounterKeyCondition, emailCounterPrefixes } from "./loginDevices";

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

/** アカウントの番号で1件。セッションが指す本人の保存を読む（今のパスワードの確かめ）。無ければ null。 */
export const findAccountById = async (db: Db, accountId: string): Promise<AccountRow | null> => {
  const row = await db.prepare(`SELECT id, email, password_hash, role, store_id, must_change_password FROM accounts WHERE id = ?1`).bind(accountId).first();
  return toRow(row as Record<string, unknown> | null);
};

/**
 * 書き込みの落ちが「メールアドレスがもう在る」かどうか。D1 は SQLite の文をそのまま伝えるので、
 * 表と列の名前で見分ける（ほかの UNIQUE——例えばセッションの合言葉——と取り違えないため）。
 * 登録（usecases/registerStore）とメールアドレスの変更（usecases/changeEmail）が共有する。
 */
export const isEmailTakenError = (error: unknown): boolean => {
  const message = error instanceof Error ? `${error.message} ${(error.cause as Error | undefined)?.message ?? ""}` : String(error);
  return /UNIQUE constraint failed:\s*accounts\.email/i.test(message);
};

/** 運営の一覧（番号とメールアドレスだけ）。運営の投入（seedAdmin）が、書く前に今いる運営を見せるために使う（安全-01）。 */
export type AdminSummary = { id: string; email: string };

export const listAdminAccounts = async (db: Db): Promise<AdminSummary[]> => {
  const result = await db.prepare(`SELECT id, email FROM accounts WHERE role = 'admin' ORDER BY email`).bind().all();
  return ((result.results ?? []) as Array<Record<string, unknown>>).map((row) => ({ id: row.id as string, email: row.email as string }));
};

/**
 * メールアドレスだけを置き換える（2026-09-22 追加）。重複は表の UNIQUE が例外で教える（呼ぶ側が受ける）。
 * 運営の投入（usecases/seedAdmin・本番へ流す文を出す）も使うので、migration 0015 の列には触れない——
 * 0015 を当てる前の本番でも、乗っ取られた運営を取り返す文が流れるように（2026-09-26 取り込みのときの AI判断）。
 */
export const updateAccountEmail = async (db: Db, accountId: string, email: string): Promise<void> => {
  await db.prepare(`UPDATE accounts SET email = ?2 WHERE id = ?1`).bind(accountId, email).run();
};

/**
 * 本人が画面からメールアドレスを変える（usecases/changeEmail）。重複は表の UNIQUE が例外で教える。
 * 別のアドレスへ変えたら「確認した時刻」（migration 0015 の列）を NULL に戻す——新しいアドレスはまだ確認していない。
 * 同じアドレス（大小の違いだけを含む）への「変更」では確認済みを残す（手続きは同じ値でも書くため）。
 * メールを送る口の有無にかかわらず書く（列が在れば害は無い・2026-09-26 に枝 feat/email-verify から取り込んだ）。
 *
 * 別のアドレスへ変えたら、**前のアドレス**（`previousEmail`）を鍵に含む数え（端末の印・締め出しの数え）を、書き換えと
 * 同じまとまりで消す（2026-09-26 独立したレビューの指摘・AI判断）。残すと、あとで店が退会しても前のアドレスが表に残った
 * （退会は今のアドレスの行しか消さない）。書き換えが UNIQUE で落ちたら、まとまりごと書かない。
 */
export const changeOwnAccountEmail = async (db: Db, accountId: string, email: string, previousEmail: string): Promise<void> => {
  const update = db
    .prepare(`UPDATE accounts SET email = ?2, email_verified_at = CASE WHEN email = ?2 COLLATE NOCASE THEN email_verified_at ELSE NULL END WHERE id = ?1`)
    .bind(accountId, email);
  if (normalizeLoginEmail(previousEmail) === normalizeLoginEmail(email)) {
    await update.run();
    return;
  }
  const forget = db.prepare(`DELETE FROM rate_counters WHERE ${emailCounterKeyCondition("?1", "?2")}`).bind(...emailCounterPrefixes(previousEmail));
  await db.batch([update, forget]);
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
  await updateAccountPasswordStatement(db, accountId, passwordHash, mustChangePassword).run();
};

/**
 * パスワードを置き換える文（流さずに返す）。仮のパスワードの発行が、セッションの削除と運営の操作の記録と
 * 同じ `db.batch` に入れる——記録が書けずに落ちたとき、パスワードだけ変わって店が締め出される形を作らない
 * （2026-09-25 監査の指摘 運営-01 のレビュー）。
 */
export const updateAccountPasswordStatement = (db: Db, accountId: string, passwordHash: string, mustChangePassword: boolean): D1PreparedStatement =>
  db.prepare(`UPDATE accounts SET password_hash = ?2, must_change_password = ?3 WHERE id = ?1`).bind(accountId, passwordHash, mustChangePassword ? 1 : 0);

/** `?<first>`, `?<first+1>`, … の並び（メールアドレスの一覧を IN へ渡す）。 */
const placeholdersFrom = (first: number, count: number): string => Array.from({ length: count }, (_, i) => `?${first + i}`).join(", ");

/**
 * 店のアカウントのパスワードを、メールアドレスで指して入れ替え、仮のパスワードの印を外す（デモ店の鍵の入れ替え・
 * README 5.3・2026-09-26 のレビュー）。読み取りを挟まない1文なので、`--print` で本番へ貼る文にそのままなる。
 * 役割が店の行だけを書き換える（運営のアカウントを巻き込まない）。
 */
export const updateStorePasswordsByEmail = async (db: Db, emails: readonly string[], passwordHash: string): Promise<void> => {
  await db
    .prepare(`UPDATE accounts SET password_hash = ?1, must_change_password = 0 WHERE role = 'store' AND email IN (${placeholdersFrom(2, emails.length)})`)
    .bind(passwordHash, ...emails)
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
