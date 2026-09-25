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
import { JST_OFFSET_MINUTES } from "../domain/until";
import type { Deps } from "../ports";
import { listCoupons } from "../repo/coupons";
import { listOfferShownCounts, listReservationStatesOfStore, type OfferReservationStateRow, type StoreOfferShownRow } from "../repo/storeResults";

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
  // ---- そのオファーの条件（2026-09-25 監査の指摘 店-13。実績はオファーごと〔要件23の補足・本人選択〕のまま、行に条件を載せる） ----
  /** 終わった時点（公開中なら今）の配信数 */
  capacity: number;
  /** 公開のときに入れた配信数（「追加で出す」で積み上がる前） */
  initialCapacity: number;
  partyMax: number;
  /** 「何時まで」の時刻（ISO 8601） */
  untilAt: string;
  /** 店が「何時まで」を入れたか（false なら公開から12時間の自動の終わり・店-05） */
  untilSet: boolean;
  /** 店か運営が止めた時刻。止めずに終わった・公開中なら null */
  endedAt: string | null;
  /** 公開中／店が止めた／時刻で終わった／運営が止めた */
  endReason: OfferEndReason;
  /** 見せたクーポンの名前（今も在るものだけ・作った順） */
  coupons: string[];
  /** 見せたクーポンの数（消したものも含む。名前の数より多ければ、消したクーポンがあった） */
  couponCount: number;
};

export type OfferEndReason = "live" | "stopped" | "time_up" | "banned";

/** 合計（今日・直近7日）。取り消しは内訳を畳んだ数 */
export type ResultTotals = { offers: number; shown: number; received: number; completed: number; cancelled: number };
export type ResultsSummary = { today: ResultTotals; week: ResultTotals };

export type StoreResults = { items: StoreResultRow[]; summary: ResultsSummary };

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

/** 終わった理由。保存されていなければ、時刻を過ぎたか（時刻ちょうどは終わり・基準 17.14）で公開中と分ける。 */
const endReasonOf = (offer: StoreOfferShownRow, now: Date): OfferEndReason => {
  if (offer.endReason === "banned") return "banned";
  if (offer.endReason !== null || offer.endedAt !== null) return "stopped";
  return offer.untilAt.getTime() <= now.getTime() ? "time_up" : "live";
};

/** そのオファーの条件（店-13）。クーポンの名前は今も在るものだけ（消したものは数にだけ入る）。 */
const conditionsOf = (offer: StoreOfferShownRow, couponNames: ReadonlyMap<string, string>, now: Date) => ({
  capacity: offer.capacity,
  initialCapacity: offer.initialCapacity,
  partyMax: offer.partyMax,
  untilAt: offer.untilAt.toISOString(),
  untilSet: offer.untilSet,
  endedAt: offer.endedAt?.toISOString() ?? null,
  endReason: endReasonOf(offer, now),
  coupons: offer.couponIds.flatMap((id) => {
    const name = couponNames.get(id);
    return name === undefined ? [] : [name];
  }),
  couponCount: offer.couponIds.length,
});

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = JST_OFFSET_MINUTES * 60 * 1000;

/** 日本時間のその日の0時（の UTC の時点）。 */
const jstDayStart = (at: Date): Date => new Date(Math.floor((at.getTime() + JST_OFFSET_MS) / DAY_MS) * DAY_MS - JST_OFFSET_MS);

const totalsOf = (rows: readonly StoreResultRow[]): ResultTotals => ({
  offers: rows.length,
  shown: rows.reduce((sum, row) => sum + row.shown, 0),
  received: rows.reduce((sum, row) => sum + row.received, 0),
  completed: rows.reduce((sum, row) => sum + row.completed, 0),
  cancelled: rows.reduce((sum, row) => sum + row.cancelled.total, 0),
});

/**
 * 今日（日本時間の0時から）と直近7日（今から7日前から）に**公開した**オファーの合計（店-13）。
 * 店が「効いている」を一目で読めるように、実績の画面のいちばん上に出す。
 */
export const summarizeResults = (rows: readonly StoreResultRow[], now: Date): ResultsSummary => {
  const since = (from: Date) => rows.filter((row) => new Date(row.publishedAt).getTime() >= from.getTime());
  return { today: totalsOf(since(jstDayStart(now))), week: totalsOf(since(new Date(now.getTime() - 7 * DAY_MS))) };
};

/** その店のオファーごとの実績と合計。1つも無ければ空の配列（画面が「まだ実績が無い」を出す・基準 23.8）。 */
export const storeResults = async (deps: Deps, storeId: string): Promise<StoreResults> => {
  const now = deps.clock.now();
  const [offers, reservations, coupons] = await Promise.all([
    listOfferShownCounts(deps.db, storeId),
    listReservationStatesOfStore(deps.db, storeId),
    listCoupons(deps.db, storeId),
  ]);
  const couponNames = new Map(coupons.map((coupon) => [coupon.id, coupon.name]));
  const items = offers.map((offer) => ({
    offerId: offer.offerId,
    publishedAt: offer.publishedAt.toISOString(),
    shown: offer.shown,
    ...countOffer(
      reservations.filter((row) => row.offerId === offer.offerId),
      now,
    ),
    ...conditionsOf(offer, couponNames, now),
  }));
  return { items, summary: summarizeResults(items, now) };
};
