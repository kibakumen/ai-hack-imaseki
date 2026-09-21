// 店の実績（要件23）。オファーごとに、取得の結果に出た回数・受け取られた数・完了済みの数・
// 取り消された数（内訳つき）を数える。手続きは Deps を引数で受け、数える元は SQL の側から読む。
//
// ⚠️ 読むだけの手続き。記録の5つの表へ1行も書かない（基準 27.7）。期限切れの記録を足すのは
//    客のホームと店のホームの持ち場（設計書「期限切れの記録」）で、ここは足さない——数えるのは
//    `reservations` の期限の列から時刻で導くので、記録が遅れて付いても数字は変わらない。
//
// ⚠️ 応答に客のデータ（呼び名・電話番号）は入れない（基準 27.6・28.2）。ここが返すのは数だけ。
//
// ⚠️ 「期限切れ」を自分で判定しない。`domain/reservation.ts` の `effectiveState` が正本
//    （設計書「どの判断をどこに置くか」の「確保の今の状態」の行）。

import { effectiveState, type EffectiveState } from "../domain/reservation";
import type { Deps } from "../ports";
import { listOfferShownCounts, listReservationStatesOfStore, type OfferReservationStateRow } from "../repo/storeResults";

/**
 * 取り消された数の内訳（基準 23.6）。「期限」が多ければ来ない客が多い、「店」が多ければ組数の
 * 出しすぎ、と店が読み分けられるように分ける（要件23の補足）。
 */
export type CancelledBreakdown = { total: number; customer: number; expired: number; store: number; admin: number };

export type StoreResultRow = {
  offerId: string;
  /** 公開した時刻（ISO 8601）。並びの元（基準 23.7）で、画面はこれを日時にして出す */
  publishedAt: string;
  /** 取得の結果に含まれて客に返った取得の回数（基準 23.2） */
  shown: number;
  /** そのオファーで作られた確保の数（基準 23.3） */
  received: number;
  /** 完了済みの確保の数。期限切れのあとに店が完了済みにしたものも入る（基準 23.4） */
  completed: number;
  /** 取り消された確保の数。期限切れのあとに完了済みにしたものは入らない（基準 23.5・23.6） */
  cancelled: CancelledBreakdown;
};

/** オファー1件ぶんの数（公開した時刻と出た回数は別に持つ）。 */
type OfferCounts = Pick<StoreResultRow, "received" | "completed" | "cancelled">;

/**
 * そのオファーの確保を、今の状態で数える（基準 23.3〜23.6）。
 *
 * `active`（まだ確保中）は受け取られた数にだけ入り、完了済みにも取り消しにも入らない。
 * `completed` は状態がそれ自体で完了済みを表すので、期限を過ぎてから完了済みにしたものも
 * ここに入る（基準 23.4）——そして取り消しには入らない（基準 23.5）。
 */
const countOffer = (rows: readonly OfferReservationStateRow[], now: Date): OfferCounts => {
  const states = rows.map((row) => effectiveState(row, now));
  const count = (state: EffectiveState): number => states.filter((current) => current === state).length;
  const cancelled = {
    customer: count("customer_cancelled"),
    expired: count("expired"),
    store: count("store_cancelled"),
    admin: count("admin_cancelled"),
  };
  return {
    received: rows.length,
    completed: count("completed"),
    cancelled: { total: cancelled.customer + cancelled.expired + cancelled.store + cancelled.admin, ...cancelled },
  };
};

/** その店のオファーごとの実績。1つも無ければ空の配列（画面が「まだ実績が無い」を出す・基準 23.8）。 */
export const storeResults = async (deps: Deps, storeId: string): Promise<StoreResultRow[]> => {
  const now = deps.clock.now();
  const [offers, reservations] = await Promise.all([listOfferShownCounts(deps.db, storeId), listReservationStatesOfStore(deps.db, storeId)]);
  return offers.map((offer) => ({
    offerId: offer.offerId,
    publishedAt: offer.publishedAt.toISOString(),
    shown: offer.shown,
    ...countOffer(
      reservations.filter((row) => row.offerId === offer.offerId),
      now,
    ),
  }));
};
