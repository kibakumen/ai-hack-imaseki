// Google の地図サービスの利用条件に沿わせる手入れ（2026-09-25 監査の指摘 設計-20 の案1・AI判断）。
//
// 利用条件（Google Maps Platform Service Specific Terms の Geocoding API の項）は、Geocoding で得た緯度と経度を
// 連続30日までしか手元に置けないとしている（place ID は無期限）。**確度: 推測**（記憶に基づく。本人が一次資料で確かめる）。
// それまでは店の座標を期限なく置いていた。この手続きが1時間に1回まで、次を行う:
//   Google で位置に直した店の座標のうち25日を過ぎたものを、住所から取り直す（1回に5件まで）。
//   取り直せないまま30日を過ぎたら座標を消す。消し方は失敗の種類で分ける（2026-09-25 設計-20 のレビュー）:
//     - 住所が位置に直らない（0件・日本の外）… 取った時刻も消し、取り直しをやめる（店が住所を保存し直すまで探す結果に出ない）
//     - 外の障害（打ち切り・通信の失敗・5xx・上限・鍵の拒否）… 座標だけを消し、取り直しを続ける。障害が明けたら座標も戻る
//       ——Google の鍵の停止や障害が5日続いても、店が黙って検索から消えたままにならない
// 手で置いた座標（デモの店）は Google の中身ではないので触らない（repo/googleData）。
// 取得の起点（fetch_logs）は触らない——記録の表の「追加だけ」（基準 27.7・本人選択で緩めないと決めた）とぶつかる。本人の判断待ち。
//
// 走らせ方: 定期の仕組み（Cron）を持たないので、客の取得のあとに `deps.defer`（本番は ctx.waitUntil）へ預けて
// 応答のあとに走らせる（usecases/fetchOffers の末尾）。預ける口が無い場面（受け入れ検査・単体の検査）では走らせない。

import { inJapan } from "../domain/geo";
import type { Deps } from "../ports";
import { expireStoreCoordinates, findStoresToRegeocode, refreshStoreCoordinates, type StoreToRegeocode } from "../repo/googleData";
import { hitRateCounter } from "../repo/rateCounters";
import { GEOCODE_TIMEOUT_MS } from "../schemas/limits";
import { raceDeadline } from "./deadline";
import { meteredGeocoder } from "./mapsBudget";

const DAY_MS = 24 * 60 * 60 * 1000;
/** 利用条件の上限（連続30日） */
const GOOGLE_CACHE_MAX_DAYS = 30;
/** 店の座標を取り直し始める日数（上限の前に、失敗しても何度か試せる余裕を持つ・AI判断） */
const REGEOCODE_AFTER_DAYS = 25;
/** 1回の手入れで取り直す店の数（地図の請求を1時間に数件に抑える・AI判断） */
const REGEOCODE_PER_RUN = 5;
/** 手入れの間引き（連打の抑止と同じ表 rate_counters に、この鍵で1時間に1回だけ通す） */
const UPKEEP_KEY = "upkeep:google-terms";
const UPKEEP_WINDOW_MS = 60 * 60 * 1000;

/** 取り直しの答え。`not_found` は住所のせい（取り直しても直らない）、`unavailable` は外の障害（また試す） */
type RegeocodeAnswer = { kind: "found"; lat: number; lng: number } | { kind: "not_found" } | { kind: "unavailable" };

const askGoogle = async (deps: Deps, address: string): Promise<RegeocodeAnswer> => {
  const answer = await raceDeadline(GEOCODE_TIMEOUT_MS, deps.clock.after(GEOCODE_TIMEOUT_MS), (signal) => meteredGeocoder(deps).geocode(address, { signal }));
  if (!answer.ok) return { kind: "unavailable" };
  if (!answer.value.ok) return answer.value.notFound === true ? { kind: "not_found" } : { kind: "unavailable" };
  const point = { lat: answer.value.lat, lng: answer.value.lng };
  // 日本の外は「位置に直らない」と同じ扱い（基準 15.11 の保存のときと揃える）
  return inJapan(point) ? { kind: "found", ...point } : { kind: "not_found" };
};

/** 店1件の座標を取り直す。取り直せず、上限の30日を過ぎていたら、失敗の種類に合わせて座標を消す。 */
const regeocodeStore = async (deps: Deps, store: StoreToRegeocode, expiredBeforeIso: string): Promise<void> => {
  const answer = await askGoogle(deps, store.address);
  if (answer.kind === "found") {
    await refreshStoreCoordinates(deps.db, { id: store.id, address: store.address, lat: answer.lat, lng: answer.lng, geocodedAt: deps.clock.now().toISOString() });
    return;
  }
  deps.logger.log({ event: "store_regeocode_failed", id: store.id, errorKind: answer.kind });
  const retry = answer.kind === "unavailable";
  // 座標を消した店は、住所のせいと分かったときだけ取り直しをやめる（外の障害なら、そのまま次の回を待つ）
  if (!store.hasCoordinates) {
    if (!retry) await expireStoreCoordinates(deps.db, store, { retry: false });
    return;
  }
  if (store.geocodedAt < expiredBeforeIso) {
    await expireStoreCoordinates(deps.db, store, { retry });
    deps.logger.log({ event: "store_coordinates_expired", id: store.id, errorKind: answer.kind });
  }
};

/**
 * 手入れを1回（1時間に1回まで。2回目以降は何もしない）。例外は外へ出さない——落ちても取得には関わらせず、
 * 記録に1行残して次の回に任せる。
 */
export const runGoogleUpkeep = async (deps: Deps): Promise<void> => {
  try {
    const now = deps.clock.now();
    const hit = await hitRateCounter(deps.db, UPKEEP_KEY, { nowIso: now.toISOString(), windowMs: UPKEEP_WINDOW_MS, limit: 1 });
    if (hit.count > 1) return;
    const daysAgo = (days: number): string => new Date(now.getTime() - days * DAY_MS).toISOString();
    const stale = await findStoresToRegeocode(deps.db, daysAgo(REGEOCODE_AFTER_DAYS), REGEOCODE_PER_RUN);
    for (const store of stale) await regeocodeStore(deps, store, daysAgo(GOOGLE_CACHE_MAX_DAYS));
  } catch {
    deps.logger.log({ event: "google_upkeep_failed" });
  }
};

/** 応答のあとに手入れを走らせる（預ける口 deps.defer があるときだけ。無ければ走らせない＝取得の応答を待たせない）。 */
export const scheduleGoogleUpkeep = (deps: Deps): void => {
  if (deps.defer) deps.defer(runGoogleUpkeep(deps));
};
