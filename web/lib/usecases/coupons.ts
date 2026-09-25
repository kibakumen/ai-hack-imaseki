// クーポンの作成・編集・削除（要件16の基準 16.1・16.2・16.4・16.5）。
// 形と長さの検査は入口のスキーマ（schemas/coupon.ts）が済ませている。ここが見るのは規則の2つだけ——
// 3つまで（16.2）と、公開中のオファーが見せているものは変えられない（16.5）。
//
// ⚠️ 規則は**書く文の中で**確かめる（2026-09-25 監査の指摘 不具合-13・repo/coupons）。当たらなかったときだけ
//    読み直して、断りの理由（見つからない／公開中が見せている）を決める。
//
// ⚠️ 確保が持つクーポンの写し（基準 16.6）はここでは作らない。受け取りの手続き（タスク13）が
//    reservations.coupons_json に写すので、ここでの編集・削除は確保に触らない。

import type { Deps } from "../ports";
import { tokenFromBytes } from "../domain/token";
import { deleteCouponIfNotShown, findCoupon, insertCouponWithinLimit, listCoupons as listCouponRows, updateCouponIfNotShown, type CouponRow } from "../repo/coupons";
import type { CouponInput } from "../schemas/coupon";
import { COUPON_MAX, ID_BYTES } from "../schemas/limits";

export type Coupon = CouponRow;

/** 断りの語。`not_found` は入口が 404 に倒す（別の店のものか、もう無い）。 */
export type CouponRefusalKind = "limit_reached" | "coupon_in_use" | "not_found";

export type CouponResult = { ok: true; coupon: Coupon } | { ok: false; kind: CouponRefusalKind };
export type CouponDeleteResult = { ok: true } | { ok: false; kind: CouponRefusalKind };

export const listCoupons = async (deps: Deps, storeId: string): Promise<Coupon[]> => listCouponRows(deps.db, storeId);

export const createCoupon = async (deps: Deps, storeId: string, input: CouponInput): Promise<CouponResult> => {
  const coupon: Coupon = {
    id: tokenFromBytes(deps.rng.bytes(ID_BYTES)),
    name: input.name,
    note: input.note ?? "",
    createdAt: deps.clock.now().toISOString(),
  };
  // 数えることと入れることは1つの文（3つを超えない・基準 16.2）
  const inserted = await insertCouponWithinLimit(deps.db, { ...coupon, storeId, createdAtIso: coupon.createdAt }, COUPON_MAX);
  return inserted ? { ok: true, coupon } : { ok: false, kind: "limit_reached" };
};

/**
 * 書く文が当たらなかった理由を読み直して決める（編集と削除で同じ順・基準 16.4・16.5）。
 * 見つからない（別の店のものを含む）なら `not_found`。在るなら、書く文の条件で落ちたのは公開中のオファーが
 * 見せていたから（読み直すまでに公開が終わっていても、書かなかった理由はそれ）。
 */
const refusalAfterMiss = async (deps: Deps, storeId: string, couponId: string): Promise<{ ok: false; kind: CouponRefusalKind }> =>
  (await findCoupon(deps.db, storeId, couponId)) ? { ok: false, kind: "coupon_in_use" } : { ok: false, kind: "not_found" };

export const updateCoupon = async (deps: Deps, storeId: string, couponId: string, input: CouponInput): Promise<CouponResult> => {
  const nowIso = deps.clock.now().toISOString();
  const updated = await updateCouponIfNotShown(deps.db, { storeId, couponId, name: input.name, note: input.note ?? "", nowIso });
  return updated ? { ok: true, coupon: updated } : refusalAfterMiss(deps, storeId, couponId);
};

export const deleteCoupon = async (deps: Deps, storeId: string, couponId: string): Promise<CouponDeleteResult> => {
  const nowIso = deps.clock.now().toISOString();
  const deleted = await deleteCouponIfNotShown(deps.db, { storeId, couponId, nowIso });
  return deleted ? { ok: true } : refusalAfterMiss(deps, storeId, couponId);
};
