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
