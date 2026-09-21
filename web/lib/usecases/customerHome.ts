// 客の画面がまず呼ぶ入口の中身（要件1の基準 1.8）。登録が済んでいる客には取得の画面を返す。
// ⚠️ 確保中・期限切れ・取り消し・完了済みの表示の切り替え（優先の順・設計書「客の画面」）は
// タスク13〜16 がこの手続きに足す。ここでは登録の有無だけで kind を決める。

import type { Deps } from "../ports";
import { findCustomerProfile } from "../repo/customers";
import type { CustomerProfile } from "../schemas/customer";

export type CustomerHome = {
  kind: "fetch";
  profile: CustomerProfile;
};

/** 登録が見つからなければ null（入口が見分けの断り 401 に倒す）。 */
export const customerHome = async (deps: Deps, customerId: string): Promise<CustomerHome | null> => {
  const profile = await findCustomerProfile(deps.db, customerId);
  if (!profile) return null;
  return { kind: "fetch", profile };
};
