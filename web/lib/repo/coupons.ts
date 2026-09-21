// coupons の表への読み書き（設計書「ファイル構成の計画」: lib/repo は D1 の SQL）。
// どの問い合わせも店の番号で絞る——別の店のクーポンに当たる経路を作らないため（基準 16.4）。

import type { Deps } from "../ports";
import { publishingOfferCondition } from "./sqlFragments";

type Db = Deps["db"];

export type CouponRow = { id: string; name: string; note: string; createdAt: string };

export type NewCoupon = { id: string; storeId: string; name: string; note: string; createdAtIso: string };

const toCoupon = (row: Record<string, unknown>): CouponRow => ({
  id: row.id as string,
  name: row.name as string,
  note: (row.note as string) ?? "",
  createdAt: row.created_at as string,
});

/**
 * その店のクーポンを作った順に。
 * ⚠️ `created_at` だけでは並びが決まらない——偽の時計は勝手に進まないので、同じ刻の行が並ぶ。
 * 書き込んだ順（rowid）を第2の鍵にして、並びを決まったものにする。
 */
export const listCoupons = async (db: Db, storeId: string): Promise<CouponRow[]> => {
  const result = await db
    .prepare(`SELECT id, name, note, created_at FROM coupons WHERE store_id = ?1 ORDER BY created_at ASC, rowid ASC`)
    .bind(storeId)
    .all();
  return ((result.results ?? []) as Array<Record<string, unknown>>).map(toCoupon);
};

export const countCoupons = async (db: Db, storeId: string): Promise<number> => {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM coupons WHERE store_id = ?1`).bind(storeId).first();
  return Number(row?.n ?? 0);
};

/** その店の1件。別の店のクーポンの番号を渡されたら null（在ることも知らせない）。 */
export const findCoupon = async (db: Db, storeId: string, couponId: string): Promise<CouponRow | null> => {
  const row = await db.prepare(`SELECT id, name, note, created_at FROM coupons WHERE id = ?1 AND store_id = ?2`).bind(couponId, storeId).first();
  return row ? toCoupon(row as Record<string, unknown>) : null;
};

export const insertCoupon = async (db: Db, coupon: NewCoupon): Promise<void> => {
  await db
    .prepare(`INSERT INTO coupons (id, store_id, name, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`)
    .bind(coupon.id, coupon.storeId, coupon.name, coupon.note, coupon.createdAtIso)
    .run();
};

export const updateCoupon = async (db: Db, storeId: string, couponId: string, values: { name: string; note: string }): Promise<void> => {
  await db.prepare(`UPDATE coupons SET name = ?3, note = ?4 WHERE id = ?1 AND store_id = ?2`).bind(couponId, storeId, values.name, values.note).run();
};

export const deleteCoupon = async (db: Db, storeId: string, couponId: string): Promise<void> => {
  await db.prepare(`DELETE FROM coupons WHERE id = ?1 AND store_id = ?2`).bind(couponId, storeId).run();
};

/** offers.coupon_ids は番号の JSON の並び。壊れていれば「見せていない」に倒す（落ちない・要件29）。 */
const parseCouponIds = (raw: unknown): string[] => {
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
};

/**
 * 公開中のオファーがそのクーポンを見せているか（基準 16.5）。
 *
 * ⚠️ この問い合わせが offers の表を読むのは、クーポンを変えてよいかという**クーポンの側の規則**の
 *    ためで、オファーの読み書きそのものではない（オファーの repo はタスク8以降が置く）。
 * ⚠️ 番号の照合を SQL の中で `json_each` に任せず、取り出して TS で見る——公開中のオファーは
 *    店ごとに高々1つ（基準 17.9）なので行数が増えず、D1 の JSON の関数に寄りかからずに済む。
 */
export const isCouponShownByPublishingOffer = async (db: Db, storeId: string, couponId: string, nowIso: string): Promise<boolean> => {
  const result = await db
    .prepare(`SELECT coupon_ids FROM offers AS o WHERE o.store_id = ?1 AND ${publishingOfferCondition("o", "?2")}`)
    .bind(storeId, nowIso)
    .all();
  return ((result.results ?? []) as Array<Record<string, unknown>>).some((row) => parseCouponIds(row.coupon_ids).includes(couponId));
};
