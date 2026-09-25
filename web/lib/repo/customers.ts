// customers の表への読み書き（設計書「ファイル構成の計画」: lib/repo は D1 の SQL）。
// 表に置くのは客の識別子の SHA-256（token_hash）だけで、Cookie に配った生の値は置かない
// （設計書「客の識別子」）。時刻の比較が要る問い合わせは、束縛した「今」を引数で受ける。

import type { Deps } from "../ports";
import { changedRows, parseStringList } from "./d1";
import { activeReservationCondition, expiredWithinGraceCondition } from "./sqlFragments";
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

/**
 * Cookie の客の識別子（の SHA-256）から客の番号を引く。無い・消去済みなら null（入口が 401 に倒す）。
 * 2026-09-25 監査の指摘 設計-13 で入口の層（http/guards）から移した。
 */
export const findCustomerIdByTokenHash = async (db: Db, tokenHash: string): Promise<string | null> => {
  const row = await db.prepare(`SELECT id FROM customers WHERE token_hash = ?1 AND deleted_at IS NULL`).bind(tokenHash).first<{ id: string }>();
  return row ? row.id : null;
};

export const insertCustomer = async (db: Db, customer: NewCustomer): Promise<void> => {
  await db
    .prepare(`INSERT INTO customers (id, nickname, phone, genres, budget_max, token_hash) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
    .bind(customer.id, customer.nickname, customer.phone, customer.genres, customer.budgetMax, customer.tokenHash)
    .run();
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
 * 登録を消す（要件28の基準 28.6・28.8【最終日】・タスク32 が足した）。消せたら true。
 *
 * **行は消さない**——要件27の記録（`fetch_logs` ほか）がこの `id` を指しており、行を消すと記録が壊れる
 * （消しても記録は残す・基準 28.10・本人選択）。消すのは4項目（呼び名・電話番号・好みのジャンル・
 * 予算の上限）と、見分けに使う `token_hash`——空にするのでその Cookie はもう誰にも当たらない（基準 28.8）。
 *
 * **消せない条件を同じ文の WHERE に入れる**（不具合-15）: 確保中の確保も、期限から20分以内の期限切れの確保も
 * 無いこと（基準 28.5）。判断の正本は `domain/customer.canDeleteRegistration` で、この条件はその SQL 版——
 * **どちらかを直したら両方直す**。手続きが読んで確かめたあとに受け取りが入っても、確保を残したまま消さない。
 *
 * 同じまとまりで、その客のものを2つ片づける（どちらも、消せたときだけ当たる条件つき）:
 *   - 確保の行に写した電話番号（`reservations.customer_phone`・安全-17）を空にする。店の一覧にもう出さない
 *   - 通知の宛先（`push_subscriptions`）を消す。もう誰も見分けられない客へ知らせを送らない（不具合-15 の直し方の注）
 *
 * 既に消えている客には当たらない（何も起きない）＝2度押しても記録は動かない。
 */
export const eraseCustomer = async (db: Db, customerId: string, input: { nowIso: string; expiredGraceFromIso: string }): Promise<boolean> => {
  const erasedNow = `EXISTS (SELECT 1 FROM customers c WHERE c.id = ?1 AND c.deleted_at = ?2)`;
  const [erased] = await db.batch([
    db
      .prepare(
        `UPDATE customers SET nickname = '', phone = '', genres = '[]', budget_max = NULL, token_hash = NULL, deleted_at = ?2` +
          ` WHERE id = ?1 AND deleted_at IS NULL` +
          ` AND NOT EXISTS (SELECT 1 FROM reservations res WHERE res.customer_id = ?1` +
          ` AND ((${activeReservationCondition("res", "?2")}) OR (${expiredWithinGraceCondition("res", "?2", "?3")})))`,
      )
      .bind(customerId, input.nowIso, input.expiredGraceFromIso),
    db.prepare(`UPDATE reservations SET customer_phone = NULL WHERE customer_id = ?1 AND ${erasedNow}`).bind(customerId, input.nowIso),
    db.prepare(`DELETE FROM push_subscriptions WHERE customer_id = ?1 AND ${erasedNow}`).bind(customerId, input.nowIso),
  ]);
  return changedRows(erased) > 0;
};

export const findCustomerProfile = async (db: Db, customerId: string): Promise<CustomerProfile | null> => {
  const row = await db.prepare(`SELECT nickname, phone, genres, budget_max FROM customers WHERE id = ?1 AND deleted_at IS NULL`).bind(customerId).first();
  if (!row) return null;
  return {
    nickname: (row.nickname as string | null) ?? "",
    phone: (row.phone as string | null) ?? "",
    genres: parseStringList(row.genres),
    budgetMax: (row.budget_max as number | null) ?? null,
  };
};
