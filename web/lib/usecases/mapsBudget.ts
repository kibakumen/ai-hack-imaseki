// アプリ全体の1日の地図の上限（2026-09-26 のレビュー・安全-03 の残り・AI判断）。
//
// 連打の抑止は客ごと・接続元ごとに数えるので、接続元を替えれば地図（Geocoding・Places・有料）の請求に天井が無かった。
// AI の1日の上限（usecases/aiBudget）と同じ考えで、その日（日本時間）の地図の回数が上限に届いたら、その日の残りは
// 地図を呼ばずに「直せなかった」と同じ形で返す（候補は空・地名は出さない・場所の文字では探せない・店の住所は直らない）。
// Google Cloud の割り当て（README 6.2 の手順7）は二重の備えとして残す。
//
// 数えは連打の抑止と同じ表（rate_counters）の1行を、日本時間の日ごとの鍵で1文ずつ足す（repo/rateCounters・原子的）。
// 窓は2日にして、その日のうちに数え直しが起きないようにする（鍵が日ごとに替わるので、前の日の行は読まれない）。
// 地図を呼ぶ手続き（取得・場所の候補・地名・店の住所・店の座標の手入れ）は、deps.geocoder の代わりに meteredGeocoder を使う。

import type { Deps, Geocoder } from "../ports";
import { hitRateCounter } from "../repo/rateCounters";
import { MAPS_DAILY_CALL_LIMIT } from "../schemas/limits";
import { startOfJstDayIso } from "./aiBudget";

export const COUNTER_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

/** その時刻を含む日本時間の1日の数えの鍵。 */
export const mapsDailyKey = (now: Date): string => `mapsDaily:${startOfJstDayIso(now)}`;

/** 地図を1回呼んでよいか（呼ぶなら1回ぶんを数える）。上限を越えた最初の1回だけ記録に残す（運営が後から気づけるように）。 */
const takeMapsCall = async (deps: Deps): Promise<boolean> => {
  const now = deps.clock.now();
  const counted = await hitRateCounter(deps.db, mapsDailyKey(now), { nowIso: now.toISOString(), windowMs: COUNTER_WINDOW_MS, limit: MAPS_DAILY_CALL_LIMIT });
  if (counted.count <= MAPS_DAILY_CALL_LIMIT) return true;
  if (counted.count === MAPS_DAILY_CALL_LIMIT + 1) deps.logger.log({ event: "maps_daily_limit_reached" });
  return false;
};

/**
 * その日の上限を数えてから呼ぶ地図の口。口の形（逆方向・候補の有無）は deps.geocoder と同じ。
 * 上限に届いたら外へ聞かずに `{ ok: false }`（`notFound` は付けない＝外の障害と同じ扱い。店の座標の手入れは次の回にまた試す）。
 */
export const meteredGeocoder = (deps: Deps): Geocoder => {
  const inner = deps.geocoder;
  const { reverse, suggest } = inner;
  return {
    geocode: async (text, opts) => ((await takeMapsCall(deps)) ? inner.geocode(text, opts) : { ok: false }),
    ...(reverse ? { reverse: async (point, opts) => ((await takeMapsCall(deps)) ? reverse.call(inner, point, opts) : { ok: false }) } : {}),
    ...(suggest ? { suggest: async (text, opts) => ((await takeMapsCall(deps)) ? suggest.call(inner, text, opts) : { ok: false }) } : {}),
  };
};
