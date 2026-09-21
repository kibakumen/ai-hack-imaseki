// クーポンの作成・編集・削除（要件16の基準 16.1・16.2・16.4・16.5）。
// 形と長さの検査は入口のスキーマ（schemas/coupon.ts）が済ませている。ここが見るのは規則の2つだけ——
// 3つまで（16.2）と、公開中のオファーが見せているものは変えられない（16.5）。
//
// ⚠️ 確保が持つクーポンの写し（基準 16.6）はここでは作らない。受け取りの手続き（タスク13）が
//    reservations.coupons_json に写すので、ここでの編集・削除は確保に触らない。

import type { Deps } from "../ports";
import { tokenFromBytes } from "../domain/token";
import {
  countCoupons,
  deleteCoupon as deleteCouponRow,
  findCoupon,
  insertCoupon,
  isCouponShownByPublishingOffer,
  listCoupons as listCouponRows,
  updateCoupon as updateCouponRow,
  type CouponRow,
} from "../repo/coupons";
import type { CouponInput } from "../schemas/coupon";
import { COUPON_MAX, ID_BYTES } from "../schemas/limits";

export type Coupon = CouponRow;

/** 断りの語。`not_found` は入口が 404 に倒す（別の店のものか、もう無い）。 */
export type CouponRefusalKind = "limit_reached" | "coupon_in_use" | "not_found";

export type CouponResult = { ok: true; coupon: Coupon } | { ok: false; kind: CouponRefusalKind };
export type CouponDeleteResult = { ok: true } | { ok: false; kind: CouponRefusalKind };

export const listCoupons = async (deps: Deps, storeId: string): Promise<Coupon[]> => listCouponRows(deps.db, storeId);

export const createCoupon = async (deps: Deps, storeId: string, input: CouponInput): Promise<CouponResult> => {
  if ((await countCoupons(deps.db, storeId)) >= COUPON_MAX) return { ok: false, kind: "limit_reached" };

  const coupon: Coupon = {
    id: tokenFromBytes(deps.rng.bytes(ID_BYTES)),
    name: input.name,
    note: input.note ?? "",
    createdAt: deps.clock.now().toISOString(),
  };
  await insertCoupon(deps.db, { ...coupon, storeId, createdAtIso: coupon.createdAt });
  return { ok: true, coupon };
};

/**
 * 変えてよいかを確かめる。見つからない（別の店のものを含む）か、公開中のオファーが見せているなら断る。
 * 編集と削除で同じ順に確かめる（基準 16.4・16.5）。
 */
const guardChange = async (deps: Deps, storeId: string, couponId: string): Promise<{ ok: true; coupon: Coupon } | { ok: false; kind: CouponRefusalKind }> => {
  const coupon = await findCoupon(deps.db, storeId, couponId);
  if (!coupon) return { ok: false, kind: "not_found" };
  const inUse = await isCouponShownByPublishingOffer(deps.db, storeId, couponId, deps.clock.now().toISOString());
  return inUse ? { ok: false, kind: "coupon_in_use" } : { ok: true, coupon };
};

export const updateCoupon = async (deps: Deps, storeId: string, couponId: string, input: CouponInput): Promise<CouponResult> => {
  const guard = await guardChange(deps, storeId, couponId);
  if (!guard.ok) return guard;

  const next: Coupon = { ...guard.coupon, name: input.name, note: input.note ?? "" };
  await updateCouponRow(deps.db, storeId, couponId, { name: next.name, note: next.note });
  return { ok: true, coupon: next };
};

export const deleteCoupon = async (deps: Deps, storeId: string, couponId: string): Promise<CouponDeleteResult> => {
  const guard = await guardChange(deps, storeId, couponId);
  if (!guard.ok) return guard;

  await deleteCouponRow(deps.db, storeId, couponId);
  return { ok: true };
};
