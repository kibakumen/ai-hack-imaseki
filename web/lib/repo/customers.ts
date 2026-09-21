// customers の表への読み書き（設計書「ファイル構成の計画」: lib/repo は D1 の SQL）。
// 表に置くのは客の識別子の SHA-256（token_hash）だけで、Cookie に配った生の値は置かない
// （設計書「客の識別子」）。時刻の比較が要る問い合わせは、束縛した「今」を引数で受ける。

import type { Deps } from "../ports";
import type { CustomerProfile } from "../schemas/customer";

type Db = Deps["db"];

export type NewCustomer = {
  id: string;
  nickname: string;
  phone: string;
  /** ジャンルの配列を JSON の文字列にしたもの */
  genres: string;
  budgetMax: number | null;
  tokenHash: string;
};

export const insertCustomer = async (db: Db, customer: NewCustomer): Promise<void> => {
  await db
    .prepare(`INSERT INTO customers (id, nickname, phone, genres, budget_max, token_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
    .bind(customer.id, customer.nickname, customer.phone, customer.genres, customer.budgetMax, customer.tokenHash)
    .run();
};

/** 壊れた JSON は「1つも選んでいない」として読む（表示が止まらないようにする）。 */
const parseGenres = (raw: unknown): string[] => {
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
};

/**
 * 登録の4項目を入れ替える（要件1の基準 1.9【最終日】）。消去済みの客は当たらないので、
 * 何も起きない（呼ぶ側が読み直して、消えていれば null として扱う）。
 */
export const updateCustomerProfile = async (db: Db, customerId: string, profile: Omit<NewCustomer, "id" | "tokenHash">): Promise<void> => {
  await db
    .prepare(`UPDATE customers SET nickname = ?2, phone = ?3, genres = ?4, budget_max = ?5 WHERE id = ?1 AND deleted_at IS NULL`)
    .bind(customerId, profile.nickname, profile.phone, profile.genres, profile.budgetMax)
    .run();
};

/**
 * 登録を消す（要件28の基準 28.6・28.8【最終日】・タスク32 が足した）。**行は消さない**——
 * 要件27の記録（`fetch_logs` ほか）がこの `id` を指しており、行を消すと記録が壊れる
 * （消しても記録は残す・基準 28.10・本人選択）。消すのは4項目（呼び名・電話番号・好みのジャンル・
 * 予算の上限）と、見分けに使う `token_hash`——空にするのでその Cookie はもう誰にも当たらない（基準 28.8）。
 *
 * 既に消えている客には当たらない（何も起きない）＝2度押しても記録は動かない。
 */
export const eraseCustomer = async (db: Db, customerId: string, atIso: string): Promise<void> => {
  await db
    .prepare(`UPDATE customers SET nickname = '', phone = '', genres = '[]', budget_max = NULL, token_hash = NULL, deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL`)
    .bind(customerId, atIso)
    .run();
};

export const findCustomerProfile = async (db: Db, customerId: string): Promise<CustomerProfile | null> => {
  const row = await db.prepare(`SELECT nickname, phone, genres, budget_max FROM customers WHERE id = ?1 AND deleted_at IS NULL`).bind(customerId).first();
  if (!row) return null;
  return {
    nickname: (row.nickname as string | null) ?? "",
    phone: (row.phone as string | null) ?? "",
    genres: parseGenres(row.genres),
    budgetMax: (row.budget_max as number | null) ?? null,
  };
};
