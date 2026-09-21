// 承認（要件25の基準 25.1・25.2）。営業許可書とカードの両方が揃った未承認の店だけが承認済みになる。
// 承認を断る手続きは無い（基準 25.3。断るときは運営が一覧のメールアドレスへ自分のメールで伝える）。

import type { Deps } from "../ports";
import { approveStoreStatement, findStoreForAdmin } from "../repo/adminStores";
import type { StoreStatus } from "../repo/stores";

/** 足りないものの項目名（設計書「入力の誤りの出し方」の 25.2 の行）。 */
export type ApprovalMissingField = "license" | "card";

export type ApproveStoreResult =
  | { ok: true }
  | { ok: false; kind: "not_found" }
  /** 許可書かカードが足りない（応答は 409・`approval_missing`） */
  | { ok: false; kind: "approval_missing"; missing: ApprovalMissingField[] }
  /** 未承認ではない（もう承認済み・止められている）。今の状況を返して断る */
  | { ok: false; kind: "state"; state: StoreStatus };

/**
 * 承認する。足りないものがあるときは D1 を1文字も変えず、足りないものを返す（基準 25.2・状況は未承認のまま）。
 * 状況の書き換えは「前の状況を WHERE に入れた1つの UPDATE」で、変わった行が0なら断る。
 */
export const approveStore = async (deps: Deps, storeId: string): Promise<ApproveStoreResult> => {
  const store = await findStoreForAdmin(deps.db, storeId, deps.clock.now().toISOString());
  if (!store) return { ok: false, kind: "not_found" };
  if (store.status !== "pending") return { ok: false, kind: "state", state: store.status };

  const missing: ApprovalMissingField[] = [];
  if (!store.license) missing.push("license");
  if (!store.cardRegistered) missing.push("card");
  if (missing.length > 0) return { ok: false, kind: "approval_missing", missing };

  const result = await approveStoreStatement(deps.db, storeId).run();
  // 読んでから書くまでの間に状況が動いた（同時に来た操作）なら、変わった行は0になる。
  // 変わった行の数を返さない D1 の版もありうるので、数が分かるときだけ断る（分からないときは通す）。
  const changes: unknown = result?.meta?.changes;
  if (typeof changes === "number" && changes === 0) return { ok: false, kind: "state", state: store.status };
  return { ok: true };
};
