// 客の登録の変更（要件1の基準 1.9【最終日】）。呼び名・電話番号・好みのジャンル・予算の上限の
// 4項目を、まとめて入れ替える。範囲の検査は入口（defineRoute のスキーマ）が済ませているので、
// ここは保存の形へ直して書き、書いたあとの登録を読み直して返すだけ。
//
// 読み直すのは、画面が続けてもう1回ホームを呼ばずに済ませるためと、書く直前に登録が消えた場合
// （端末は識別子を持っているのに登録が無い・基準 1.11）を null として呼ぶ側へ伝えるため。

import type { Deps } from "../ports";
import { findCustomerProfile, updateCustomerProfile as writeProfile } from "../repo/customers";
import type { CustomerProfile, CustomerRegisterInput } from "../schemas/customer";

/** 変えたあとの登録。書く相手が見つからなければ null（入口が見分けの断り 401 に倒す）。 */
export const updateCustomerProfile = async (deps: Deps, customerId: string, input: CustomerRegisterInput): Promise<CustomerProfile | null> => {
  await writeProfile(deps.db, customerId, {
    nickname: input.nickname,
    phone: input.phone,
    genres: JSON.stringify(input.genres),
    budgetMax: input.budgetMax ?? null,
  });
  return findCustomerProfile(deps.db, customerId);
};
