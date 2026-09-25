// 運営の操作が当たらなかったときの断り（2026-09-25 監査の指摘 運営-02・運営-04 のレビュー）。
//
// 承認・止める・戻す・「今の内容を確かめた」は、先に店を読んでから「読んだ内容を WHERE に入れた1つの UPDATE」で書く。
// 読んでから書くまでの間にほかの操作が先に書くと、その UPDATE は当たらない。そのとき**先に読んだ古い状況を返すと**、
// 画面は「ほかの操作で、すでに『承認済み』に」と、実際とは逆の文を出す。当たらなかったら読み直して、今を返す。

import type { Deps } from "../ports";
import { findStoreStatus, type StoreReview } from "../repo/adminStoreActions";
import type { StoreStatus } from "../repo/stores";
import type { AdminSeenStore } from "../schemas/admin";

/** 店が見つからない、または今の状況が操作に合わない（今の状況を返す）。 */
export type StoreStateRefusal = { ok: false; kind: "not_found" } | { ok: false; kind: "state"; state: StoreStatus };

/** 店を指す操作の断り。`changed` は、状況は同じだが運営が見た（読んだ）あとで店名・住所・許可書が変わった。 */
export type StoreRefusal = StoreStateRefusal | { ok: false; kind: "changed"; state: StoreStatus };

/** 今の状況を読み直して断る（止める・戻すが当たらなかったとき）。店が無くなっていれば not_found。 */
export const currentStateRefusal = async (deps: Deps, storeId: string): Promise<StoreStateRefusal> => {
  const status = await findStoreStatus(deps.db, storeId);
  return status ? { ok: false, kind: "state", state: status } : { ok: false, kind: "not_found" };
};

/**
 * 承認・確かめが当たらなかったとき。状況が `expected` のままなら、当たらなかったのは内容が変わったから（`changed`）。
 * 状況が動いていれば今の状況を返す。`expected` を渡さない（状況を条件にしない確かめ）ときは、見つかれば `changed`。
 */
export const reviewRefusal = async (deps: Deps, storeId: string, expected?: StoreStatus): Promise<StoreRefusal> => {
  const refusal = await currentStateRefusal(deps, storeId);
  if (refusal.kind !== "state") return refusal;
  return expected === undefined || refusal.state === expected ? { ok: false, kind: "changed", state: refusal.state } : refusal;
};

/**
 * 運営が画面で見た内容と、今の内容が同じか（運営-02 のレビュー）。見た内容を載せない要求（入口では任意）は同じと見る。
 * 許可書は「上げた時刻」で見分ける——上げ直すたびに変わり、置き場の鍵を画面に出さずに済む。
 */
export const matchesSeen = (review: StoreReview, seen: AdminSeenStore | undefined): boolean =>
  seen === undefined || (seen.name === review.name && seen.address === review.address && seen.licenseUploadedAt === review.licenseUploadedAt);
