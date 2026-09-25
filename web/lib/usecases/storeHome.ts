// 店のホームの中身（要件12の基準 12.6・12.7・12.8、要件13の基準 13.8）。
// 承認の状況・準備のチェックリスト（営業許可書・カード）・足りない店の情報・クーポンの一覧を返す。
//
// ⚠️ **この関数は3つのタスクが順に育てる**（2026-09-21 の並列の実装・タスク表の申し送り）。
//    タスク7（ここ）が骨と `checklist`・`missingProfile`・`coupons` を置き、
//    **タスク9 が `offer` と `publishPrefill`**、**タスク17 が `arrivals`** を埋める。
//    下の3か所の ⚠️ が、その差し込み口（ほかの行は触らずに済む形にしてある）。

import { arrivalRows, ARRIVALS_WINDOW_MS, missingProfileFields, type ArrivalView, type OfferView, type PublishPrefillView, type StoreStatusView } from "../domain/storeHome";
import type { TrendBucket } from "../domain/offerTrend";
import type { Deps } from "../ports";
import { listCoupons, type CouponRow } from "../repo/coupons";
import { insertExpiredEvents } from "../repo/logs";
import { listStoreArrivals } from "../repo/reservations";
import { findStoreHomeRow } from "../repo/stores";
import { storeHomeOfferPart } from "./storeHomeOffer";

export type StoreHome = {
  id: string;
  status: StoreStatusView;
  /** 承認に足りないものの有無（基準 12.8・13.8。カードは登録済みかどうかだけ） */
  checklist: { license: boolean; card: boolean };
  /** 公開に足りない店の情報の項目（基準 12.8・17.11） */
  missingProfile: string[];
  offer: OfferView | null;
  publishPrefill: PublishPrefillView;
  /** 公開中のオファーの「今日の動き」（15分ごと・店-15）。公開中が無ければ空 */
  trend: TrendBucket[];
  coupons: CouponRow[];
  arrivals: ArrivalView[];
};

/** 一覧と期限切れの記録が読む幅の下限（残り方のいちばん長い24時間・設計-08）。 */
const arrivalsSinceIso = (now: Date): string => new Date(now.getTime() - ARRIVALS_WINDOW_MS).toISOString();

/**
 * 「向かっている客」の一覧（要件20の基準 20.1〜20.5・20.14〜20.16）。
 * どの行を出すか・できる操作の判断は `domain/storeHome` の `arrivalRows`（純粋）が持ち、
 * ここは読む幅（残り方のいちばん長い24時間）を決めて渡すだけ。
 */
const storeArrivals = async (deps: Deps, storeId: string, storeBanned: boolean, now: Date): Promise<ArrivalView[]> => {
  const rows = await listStoreArrivals(deps.db, storeId, arrivalsSinceIso(now));
  return arrivalRows(rows, now, { storeBanned });
};

/**
 * 見分けの直後に店が消えた場合だけ null（入口が 401 に倒す）。
 *
 * 店の行とクーポンは**1回ずつ**読み、オファーの部分へ渡す（2026-09-25 監査の指摘 設計-10: それまでオファーの部分が
 * 同じ2つを読み直し、30秒ごとに D1 を2往復余計に呼んでいた）。足りない店の情報は `missingProfileFields` 1本
 * （公開の断り `profile_incomplete` の `fields` と同じ答え）。
 */
export const storeHome = async (deps: Deps, storeId: string): Promise<StoreHome | null> => {
  const store = await findStoreHomeRow(deps.db, storeId);
  if (!store) return null;
  const now = deps.clock.now();

  // 期限切れの記録（要件27の基準 27.4）は、読む側の手続きの先頭で足す（設計書「期限切れの記録」）。
  // 期限切れは書き込みを伴わないので、客のホームと店のホームのどちらかが読んだ時に記録が付く。
  // 何度呼んでも増えない（タスク13が足した `insertExpiredEvents` が番号で重なりを落とす）。
  // 店の側は一覧と同じ幅だけを見る（全期間を30秒ごとに読み直さない・設計-08）。
  await insertExpiredEvents(deps.db, { kind: "store", id: storeId, sinceIso: arrivalsSinceIso(now) }, now.toISOString());

  const coupons = await listCoupons(deps.db, storeId);

  return {
    id: store.id,
    status: store.status,
    ...(await storeHomeOfferPart(deps, storeId, coupons)),
    checklist: { license: store.licenseKey !== null, card: store.cardRegisteredAt !== null },
    missingProfile: missingProfileFields(store),
    coupons,
    arrivals: await storeArrivals(deps, storeId, store.status === "banned", now),
  };
};
