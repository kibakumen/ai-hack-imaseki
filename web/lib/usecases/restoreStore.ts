// 承認済みへ戻す（要件25の基準 25.9・25.10）。止められている店だけが戻せる。
//
// **戻しても、終わったオファーと取り消された確保は戻らない**（基準 25.10）——この手続きが触るのは
// `stores.status` の1列だけで、`offers.ended_at` にも `reservations.status` にも1文字も書かない。
// 店は戻ったあと、新しく公開し直す（終わったオファーを再開する入口は無い・基準 17.15）。
//
// 断りの形は `banStore`・`approveStore` と同じ（`{ ok:false, current:{ state } }` の409）。

import type { Deps } from "../ports";
import { findStoreStatus, restoreBannedStore } from "../repo/adminStores";
import type { StoreStatus } from "../repo/stores";

export type RestoreStoreResult =
  | { ok: true }
  | { ok: false; kind: "not_found" }
  /** 止められていない（未承認・もう承認済み）。今の状況を返して断る（基準 25.9） */
  | { ok: false; kind: "state"; state: StoreStatus };

export const restoreStore = async (deps: Deps, storeId: string): Promise<RestoreStoreResult> => {
  const status = await findStoreStatus(deps.db, storeId);
  if (!status) return { ok: false, kind: "not_found" };
  if (status !== "banned") return { ok: false, kind: "state", state: status };

  // 読んでから書くまでの間に状況が動いた（同時に来た操作）なら、当たらない。変わった行の数が
  // 分からないときも「当たらなかった」側へ倒す（repo/d1 の changedRows・`approveStore` と同じ形）。
  if (!(await restoreBannedStore(deps.db, storeId))) return { ok: false, kind: "state", state: status };

  deps.logger.log({ event: "restore_store", id: storeId });
  return { ok: true };
};
