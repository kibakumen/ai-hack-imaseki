// 緊急の停止（要件25の基準 25.4・25.6・25.7）の**最小の形**。
//
// ⚠️ ここはタスク8の持ち場の分だけ: 承認済みの店を「止められている」にして、公開中のオファーを
// 終わりにする（タスク表の実装メモ「止める操作が無くても検査は ban を呼ぶので、最小の形でここに置く」）。
// **確保中の確保を全部「運営に取り消された」にすること（基準 25.8・25.11）と、購読のある客への
// プッシュ（基準 22.2）と、承認済みへ戻すこと（基準 25.9・25.10）はタスク21が足す。**
// 足すときは、下の `db.batch([...])` の並びに文を足す形にすると、1つのまとまりのまま書ける。

import type { Deps } from "../ports";
import { banStoreStatement, endPublishedOffersStatement, findStoreStatus } from "../repo/adminStores";
import type { StoreStatus } from "../repo/stores";

export type BanStoreResult =
  | { ok: true }
  | { ok: false; kind: "not_found" }
  /** 承認済みではない（未承認・もう止められている）。今の状況を返して断る（基準 25.4） */
  | { ok: false; kind: "state"; state: StoreStatus };

/**
 * 止める。状況の書き換えとオファーの終わりは1つのまとまり（`db.batch`）で流す——
 * 片方だけが通って、止められた店に公開中のオファーが残る、という形を作らないため。
 */
export const banStore = async (deps: Deps, storeId: string): Promise<BanStoreResult> => {
  const status = await findStoreStatus(deps.db, storeId);
  if (!status) return { ok: false, kind: "not_found" };
  if (status !== "approved") return { ok: false, kind: "state", state: status };

  const nowIso = deps.clock.now().toISOString();
  const [banned] = await deps.db.batch([banStoreStatement(deps.db, storeId), endPublishedOffersStatement(deps.db, storeId, nowIso)]);
  const changes: unknown = banned?.meta?.changes;
  if (typeof changes === "number" && changes === 0) return { ok: false, kind: "state", state: status };
  return { ok: true };
};
