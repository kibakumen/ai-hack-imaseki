// 登録の消去【最終日】（要件28の基準 28.4〜28.6・28.8・28.10）。
// 消せるかどうかの判断は `domain/customer.canDeleteRegistration` が持つ（確保中の確保と、期限から
// 20分以内の期限切れの確保のどちらかが在れば消せない）。ここは読みと書きだけ。
//
// ⚠️ 記録（要件27の5つの表）には**一切触らない**（基準 28.10・本人選択。消しても残る）。
//    客の行そのものも消さず、4項目と `token_hash` を空にする（`repo/customers.eraseCustomer`）。

import { canDeleteRegistration, type DeleteRefusalKind } from "../domain/customer";
import type { Deps } from "../ports";
import { eraseCustomer, findCustomerProfile } from "../repo/customers";
import { listReservationStatesOfCustomer } from "../repo/reservations";

export type DeleteCustomerResult =
  | { ok: true }
  /** 見分けの直後に登録が消えていた（入口が 401 に倒す・基準 2.5） */
  | { ok: false; kind: "not_found" }
  | { ok: false; kind: DeleteRefusalKind };

export const deleteCustomer = async (deps: Deps, customerId: string): Promise<DeleteCustomerResult> => {
  const now = deps.clock.now();
  const profile = await findCustomerProfile(deps.db, customerId);
  if (!profile) return { ok: false, kind: "not_found" };

  const decision = canDeleteRegistration(await listReservationStatesOfCustomer(deps.db, customerId), now);
  // 断るときは D1 を1行も変えない（基準 29.3 と同じ向き。受け入れ検査が前後の中身を突き合わせる）。
  if (!decision.ok) return { ok: false, kind: decision.kind };

  await eraseCustomer(deps.db, customerId, now.toISOString());
  return { ok: true };
};
