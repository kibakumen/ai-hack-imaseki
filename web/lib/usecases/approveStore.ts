// 承認（要件25の基準 25.1・25.2）。営業許可書とカードの両方が揃った未承認の店だけが承認済みになる。
// 承認を断る手続きは無い（基準 25.3。断るときは運営が一覧のメールアドレスへ自分のメールで伝える）。

import type { Deps } from "../ports";
import { approvePendingStore, findStoreReview } from "../repo/adminStoreActions";
import type { AdminSeenStore } from "../schemas/admin";
import { newAdminAction, type AdminActor } from "./adminActionRecord";
import { matchesSeen, reviewRefusal, type StoreRefusal } from "./adminStoreConflict";

/** 足りないものの項目名（設計書「入力の誤りの出し方」の 25.2 の行）。 */
export type ApprovalMissingField = "license" | "card";

export type ApproveStoreResult =
  | { ok: true }
  /** 許可書かカードが足りない（応答は 409・`approval_missing`） */
  | { ok: false; kind: "approval_missing"; missing: ApprovalMissingField[] }
  /**
   * 見つからない／未承認ではない（もう承認済み・止められている。今の状況を返す）／
   * 運営が見たあとで店名・住所・許可書が変わった（`changed`・運営-02 のレビュー）
   */
  | StoreRefusal;

/**
 * 承認する。足りないものがあるときは D1 を1文字も変えず、足りないものを返す（基準 25.2・状況は未承認のまま）。
 * 状況の書き換えは「前の状況と読んだ内容を WHERE に入れた1つの UPDATE」で、変わった行が0なら断る。
 *
 * 承認した時点の店名・住所・許可書を写して残し、誰が承認したかを記録する（2026-09-25 監査の指摘 運営-01・運営-02）。
 * **写しに入るのは運営が見た内容だけ**（運営-02 のレビュー）: `seen`（画面が載せる、運営が見た内容）が今と違えば承認せず、
 * 読んでから書くまでの間に変わったときも UPDATE が当たらない。どちらも `changed` を返し、画面が取り直させる。
 */
export const approveStore = async (deps: Deps, storeId: string, actor: AdminActor, seen?: AdminSeenStore): Promise<ApproveStoreResult> => {
  const review = await findStoreReview(deps.db, storeId);
  if (!review) return { ok: false, kind: "not_found" };
  if (review.status !== "pending") return { ok: false, kind: "state", state: review.status };

  const missing: ApprovalMissingField[] = [];
  if (!review.licenseKey) missing.push("license");
  if (!review.cardRegistered) missing.push("card");
  if (missing.length > 0) return { ok: false, kind: "approval_missing", missing };
  if (!matchesSeen(review, seen)) return { ok: false, kind: "changed", state: review.status };

  // 読んでから書くまでの間に状況か内容が動いた（同時に来た操作）なら、当たらない。変わった行の数が
  // 分からないときも「当たらなかった」側へ倒す（repo/d1 の changedRows・監査の指摘 設計-13）。
  if (!(await approvePendingStore(deps.db, storeId, review, newAdminAction(deps, actor, "approve", storeId)))) return reviewRefusal(deps, storeId, "pending");
  deps.logger.log({ event: "approve_store", id: storeId, actor: actor.accountId });
  return { ok: true };
};
