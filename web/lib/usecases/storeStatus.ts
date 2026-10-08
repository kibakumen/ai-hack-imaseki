// 店の承認の状態だけを読む（2026-10-08 本人選択・AI提示）。
// 店舗情報の画面が承認の状態を出すために、店のホーム（向かっている客の呼び名・電話番号まで入る）を丸ごと読んでいた。
// 要るのは状態の1語だけなので、店の行の状態だけを読む手続きに分けた。客の情報には触らない。

import type { StoreStatusView } from "../domain/storeHome";
import type { Deps } from "../ports";
import { findStoreStatus } from "../repo/adminStoreActions";

/** 見分けた店の承認の状態。見分けの直後に店が消えた場合だけ null（入口が 401 に倒す）。 */
export const readStoreStatus = async (deps: Deps, storeId: string): Promise<StoreStatusView | null> => findStoreStatus(deps.db, storeId);
