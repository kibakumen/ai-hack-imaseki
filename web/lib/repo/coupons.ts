// coupons の表への読み書き（設計書「ファイル構成の計画」: lib/repo は D1 の SQL）。
// どの問い合わせも店の番号で絞る——別の店のクーポンに当たる経路を作らないため（基準 16.4）。
//
// ⚠️ **店のクーポンの読み口はこのファイルの `listCoupons` 1本**（2026-09-25 監査の指摘 設計-10）。
//    それまで同じ一覧を読む関数が3本（repo/coupons に2本・repo/offers に1本）あり、同じ時刻に作ったクーポンの
//    並びが店のホームのチェックと公開中のカードで食い違いえた。「公開中のオファーが見せているか」の判定も
//    2本あり、検査が見ていたのは本番で使われていない方だった——今は編集と削除の文の中の1つだけ。
//
// ⚠️ 規則（3つまで・公開中が見せているものは変えない）は、**書く文の WHERE の中で**確かめる（不具合-13）。
//    数えてから・読んでから条件なしで書く形では、送信中にもう一度押された「作る」や、同時の公開で規則が破れた。

import type { Deps } from "../ports";
import { changedRows } from "./d1";
import { publishingOfferCondition } from "./sqlFragments";

type Db = Deps["db"];

export type CouponRow = { id: string; name: string; note: string; createdAt: string };

export type NewCoupon = { id: string; storeId: string; name: string; note: string; createdAtIso: string };

const toCoupon = (row: Record<string, unknown>): CouponRow => ({
  id: row.id as string,
  name: (row.name as string | null) ?? "",
  note: (row.note as string | null) ?? "",
  createdAt: row.created_at as string,
});

/**
 * その店のクーポンを作った順に（要件4の基準 4.8・公開のフォームのチェックと公開中のカードの並び）。
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

/** その店の1件。別の店のクーポンの番号を渡されたら null（在ることも知らせない）。 */
export const findCoupon = async (db: Db, storeId: string, couponId: string): Promise<CouponRow | null> => {
  const row = await db.prepare(`SELECT id, name, note, created_at FROM coupons WHERE id = ?1 AND store_id = ?2`).bind(couponId, storeId).first();
  return row ? toCoupon(row as Record<string, unknown>) : null;
};

/**
 * その店の公開中のオファーが、そのクーポンを見せている（基準 16.5）——の SQL の条件。
 * この条件が offers の表を読むのは、クーポンを変えてよいかという**クーポンの側の規則**のため。
 *
 * @param couponId 束縛したクーポンの番号の置き場所
 * @param storeId 束縛した店の番号の置き場所
 * @param now 束縛した「今」の置き場所
 */
const shownByPublishingOffer = (couponId: string, storeId: string, now: string): string =>
  `EXISTS (SELECT 1 FROM offers o WHERE o.store_id = ${storeId} AND ${publishingOfferCondition("o", now)}` +
  ` AND EXISTS (SELECT 1 FROM json_each(o.coupon_ids) WHERE json_each.value = ${couponId}))`;

/**
 * 店のクーポンが上限より少ないときだけ1件入れる（基準 16.2）。入ったら true。
 * 数えることと入れることを1つの文にするので、送信中にもう一度押しても上限を超えない（不具合-13）。
 */
export const insertCouponWithinLimit = async (db: Db, coupon: NewCoupon, max: number): Promise<boolean> => {
  const result = await db
    .prepare(`INSERT INTO coupons (id, store_id, name, note, created_at) SELECT ?1, ?2, ?3, ?4, ?5 WHERE (SELECT COUNT(*) FROM coupons WHERE store_id = ?2) < ?6` +
        // 退会した店には入れない（退会と同時に走った作成が、消したクーポンを1件戻さないように・2026-09-26）
        ` AND NOT EXISTS (SELECT 1 FROM stores WHERE id = ?2 AND withdrawn_at IS NOT NULL)`)
    .bind(coupon.id, coupon.storeId, coupon.name, coupon.note, coupon.createdAtIso, max)
    .run();
  return changedRows(result) > 0;
};

/**
 * 公開中のオファーが見せていないときだけ書き換える（基準 16.4・16.5）。書き換えたら、その後の1件を返す。
 * 見つからない（別の店のものを含む）か、公開中が見せているなら null——どちらだったかは呼ぶ側が読み直して決める。
 */
export const updateCouponIfNotShown = async (
  db: Db,
  input: { storeId: string; couponId: string; name: string; note: string; nowIso: string },
): Promise<CouponRow | null> => {
  const row = await db
    .prepare(`UPDATE coupons SET name = ?3, note = ?4 WHERE id = ?1 AND store_id = ?2 AND NOT ${shownByPublishingOffer("?1", "?2", "?5")} RETURNING id, name, note, created_at`)
    .bind(input.couponId, input.storeId, input.name, input.note, input.nowIso)
    .first();
  return row ? toCoupon(row as Record<string, unknown>) : null;
};

/** 公開中のオファーが見せていないときだけ消す（基準 16.4・16.5）。消したら true。 */
export const deleteCouponIfNotShown = async (db: Db, input: { storeId: string; couponId: string; nowIso: string }): Promise<boolean> => {
  const result = await db
    .prepare(`DELETE FROM coupons WHERE id = ?1 AND store_id = ?2 AND NOT ${shownByPublishingOffer("?1", "?2", "?3")}`)
    .bind(input.couponId, input.storeId, input.nowIso)
    .run();
  return changedRows(result) > 0;
};
