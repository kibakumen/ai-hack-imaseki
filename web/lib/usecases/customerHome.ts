// 客の画面がまず呼ぶ入口の中身（要件1の基準 1.8・要件9の基準 9.1〜9.7・9.13）。
// **何を出すかの判断は `domain/customerHome.ts`** が持つ（優先の順の表）。ここは読みと記録だけ。
//
// ⚠️ 期限切れの記録（基準 27.4）は**この手続きの先頭**で足す（設計書「期限切れの記録」）——
//    期限切れは書き込みを伴わないので、読む側が足さないと記録が残らない。店のホーム
//    （`usecases/storeHome`）も同じ呼び出しを持つ。
//
// ⚠️ 通知の説明（`pushPromptDue`・基準 22.8）は**確保中の表示のときだけ**載せる——画面がそれを
//    出すのは確保中の表示だけで、ほかの表示のために購読の有無を読む理由が無い。

import { customerHomeView, type CustomerHomeView } from "../domain/customerHome";
import type { Deps } from "../ports";
import { findCustomerProfile } from "../repo/customers";
import { insertExpiredEvents } from "../repo/logs";
import { findLastFetchAt, findLatestReservation, type ReservationContext } from "../repo/reservations";
import type { CustomerProfile } from "../schemas/customer";
import { pushPromptDue } from "./pushMessage";

export type CustomerHome = CustomerHomeView & { profile: CustomerProfile; pushPromptDue?: boolean };

/** 確保の行・店・オファーを、判断の関数が読む形へ（時刻は Date のまま渡す）。 */
const toViewInput = (context: ReservationContext | null, lastFetchAt: Date | null) => {
  if (!context) return { reservation: null, offer: null, lastFetchAt };
  const { reservation, store, offer } = context;
  return {
    reservation: {
      id: reservation.id,
      code: reservation.code,
      storeId: store.id,
      storeName: store.name,
      storeAddress: store.address,
      storeUrl: store.url,
      party: reservation.party,
      expiresAt: reservation.expiresAt,
      statusAt: reservation.statusAt,
      status: reservation.status,
      coupons: reservation.coupons,
    },
    offer,
    lastFetchAt,
  };
};

/** 登録が見つからなければ null（入口が見分けの断り 401 に倒す）。 */
export const customerHome = async (deps: Deps, customerId: string): Promise<CustomerHome | null> => {
  const now = deps.clock.now();
  const nowIso = now.toISOString();

  const profile = await findCustomerProfile(deps.db, customerId);
  // 登録が無い客のために記録を足さない（消した客の分も足さない・基準 28.8）
  if (!profile) return null;

  await insertExpiredEvents(deps.db, { kind: "customer", id: customerId }, nowIso);

  const context = await findLatestReservation(deps.db, customerId, nowIso);
  // 確保が1件も無い客のために取得の記録を読まない（優先の順の4にしか要らない）
  const lastFetchAt = context ? await findLastFetchAt(deps.db, customerId) : null;

  const view = customerHomeView(toViewInput(context, lastFetchAt), now);
  // まだ通知を許可していない客にだけ、確保中の表示で説明を出す（基準 22.8・22.11）。
  if (view.kind !== "active") return { profile, ...view };
  return { profile, ...view, pushPromptDue: await pushPromptDue(deps, customerId) };
};
