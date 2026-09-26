// Google の地図サービスの利用条件に沿わせる手入れ（2026-09-25 監査の指摘 設計-20 の案1・AI判断）。
//
// 利用条件（Google Maps Platform Service Specific Terms 6.3.1・2026-09-26 に一次資料で確かめた）は、Geocoding で得た
// 緯度と経度を連続30日までしか手元に置けず、その後は消すことを求める（place ID は無期限）。
// それまでは店の座標を期限なく置いていた。この手続きが1時間に1回まで、次を行う:
//   Google で位置に直した店の座標のうち25日を過ぎたものを、住所から取り直す（1回に5件まで）。
//   取り直せないまま30日を過ぎたら座標を消す。消し方は失敗の種類で分ける（2026-09-25 設計-20 のレビュー）:
//     - 住所が位置に直らない（0件・日本の外）… 取った時刻も消し、取り直しをやめる（店が住所を保存し直すまで探す結果に出ない）
//     - 外の障害（打ち切り・通信の失敗・5xx・上限・鍵の拒否）… 座標だけを消し、取り直しを続ける。障害が明けたら座標も戻る
//       ——Google の鍵の停止や障害が5日続いても、店が黙って検索から消えたままにならない
//   最後に、30日を過ぎた座標を**件数の上限なしで**全部消す（取り直しの5件が追いつかない日の歯止め・2026-09-26 本人選択）。
//   1日1回の定期実行では、しきい値を29日（上限30日 − 間隔1日）にする（次の回までに30日を超えない・2026-09-26 レビュー）。
// 手で置いた座標（デモの店）は Google の中身ではないので触らない（repo/googleData）。
// 取得の起点（fetch_logs）は触らない——Google から得た座標はもう書かない（usecases/fetchOffers・2026-09-26 本人選択）。
//
// 走らせ方は2つ:
//   ①客の取得のあとに `deps.defer`（本番は ctx.waitUntil）へ預けて応答のあとに走らせる（usecases/fetchOffers の末尾・
//     1時間に1回まで）。預ける口が無い場面（受け入れ検査・単体の検査）では走らせない。
//   ②1日1回の定期実行（wrangler.jsonc の triggers.crons → web/worker.mjs の scheduled → lib/scheduled）。
//     客が来ない期間も30日を超えないための歯止め。取り直しは①と同じ間引きに従い、消す方は間引きに関わらず必ず走る。

import { inJapan } from "../domain/geo";
import type { Deps } from "../ports";
import { expireOverdueStoreCoordinates, expireStoreCoordinates, findStoresToRegeocode, refreshStoreCoordinates, type StoreToRegeocode } from "../repo/googleData";
import { hitRateCounter } from "../repo/rateCounters";
import { GEOCODE_TIMEOUT_MS } from "../schemas/limits";
import { raceDeadline } from "./deadline";
import { meteredGeocoder } from "./mapsBudget";

const DAY_MS = 24 * 60 * 60 * 1000;
/** 利用条件の上限（連続30日） */
const GOOGLE_CACHE_MAX_DAYS = 30;
/** 定期実行の間隔（wrangler.jsonc の triggers.crons が1日1回） */
const SCHEDULED_INTERVAL_DAYS = 1;
/**
 * 定期実行が消すしきい値（2026-09-26 独立したレビューの指摘・AI判断）。30日のままだと、30日に少し足りない座標は
 * 次の回（1日後）まで残り、最長で約31日になる。上限から間隔を引いた日数を過ぎたら消せば、次の回までに30日を超えない。
 */
const SCHEDULED_SWEEP_DAYS = GOOGLE_CACHE_MAX_DAYS - SCHEDULED_INTERVAL_DAYS;
/** 店の座標を取り直し始める日数（上限の前に、失敗しても何度か試せる余裕を持つ・AI判断） */
const REGEOCODE_AFTER_DAYS = 25;
/** 1回の手入れで取り直す店の数（地図の請求を1時間に数件に抑える・AI判断） */
const REGEOCODE_PER_RUN = 5;
/** 手入れの間引き（連打の抑止と同じ表 rate_counters に、この鍵で1時間に1回だけ通す） */
const UPKEEP_KEY = "upkeep:google-terms";
export const UPKEEP_WINDOW_MS = 60 * 60 * 1000;

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

const daysBefore = (now: Date, days: number): string => new Date(now.getTime() - days * DAY_MS).toISOString();

/** `days` 日を過ぎた座標を全部消す（件数の上限なし）。消した店があれば記録に1行残す。例外はそのまま外へ出す。 */
const sweepOverdueCoordinates = async (deps: Deps, days: number): Promise<void> => {
  const count = await expireOverdueStoreCoordinates(deps.db, daysBefore(deps.clock.now(), days));
  if (count > 0) deps.logger.log({ event: "store_coordinates_swept", count });
};

/**
 * 手入れを1回（1時間に1回まで。2回目以降は何もしない）。25日を過ぎた座標を数件取り直し、最後に30日を過ぎた座標を
 * 全部消す。例外は外へ出さない——落ちても取得には関わらせず、記録に1行残して次の回に任せる。
 */
export const runGoogleUpkeep = async (deps: Deps): Promise<void> => {
  try {
    const now = deps.clock.now();
    const hit = await hitRateCounter(deps.db, UPKEEP_KEY, { nowIso: now.toISOString(), windowMs: UPKEEP_WINDOW_MS, limit: 1 });
    if (hit.count > 1) return;
    const stale = await findStoresToRegeocode(deps.db, daysBefore(now, REGEOCODE_AFTER_DAYS), REGEOCODE_PER_RUN);
    for (const store of stale) await regeocodeStore(deps, store, daysBefore(now, GOOGLE_CACHE_MAX_DAYS));
    await sweepOverdueCoordinates(deps, GOOGLE_CACHE_MAX_DAYS);
  } catch {
    deps.logger.log({ event: "google_upkeep_failed" });
  }
};

/**
 * 1日1回の定期実行の手入れ（lib/scheduled が呼ぶ）。取り直しは `runGoogleUpkeep` と同じ（1時間の間引きに従う）。
 * そのあと、間引きに関わらず29日（上限30日 − 定期実行の間隔1日）を過ぎた座標を全部消す——客の取得が1時間以内に
 * あって取り直しが飛ばされても、消す方だけは毎日必ず走らせ、次の回までに30日を超える座標を残さない。
 * 消せなかったら例外を外へ出す（定期実行の失敗として Cloudflare の記録に残す）。
 */
export const runScheduledGoogleUpkeep = async (deps: Deps): Promise<void> => {
  await runGoogleUpkeep(deps);
  await sweepOverdueCoordinates(deps, SCHEDULED_SWEEP_DAYS);
};

/** 応答のあとに手入れを走らせる（預ける口 deps.defer があるときだけ。無ければ走らせない＝取得の応答を待たせない）。 */
export const scheduleGoogleUpkeep = (deps: Deps): void => {
  if (deps.defer) deps.defer(runGoogleUpkeep(deps));
};
