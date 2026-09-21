// 決定論の点数づけと上位10件（要件6）。AI に渡す前に、安い処理で候補を並べて絞る。
// AI は1回も呼ばない（基準 6.6）。同じ入力なら毎回同じ点数と同じ並び（基準 6.7）。
// 特記事項（クーポン）は点数に使わない（要件16の基準 16.8）——入力の型に無い。

import { SEARCH_RADIUS_METERS } from "./geo";

/** 距離点の満点（0m のとき。配分は AI判断・基準 6.2） */
export const DISTANCE_POINTS_MAX = 60;
/** ジャンル点（基準 6.3。1つでも重なれば一致と数えるのは本人選択・点の配分は AI判断） */
export const GENRE_POINTS_MATCH = 40;
export const GENRE_POINTS_NO_PREFERENCE = 20;
export const GENRE_POINTS_MISMATCH = 0;
/** AI に渡す件数の上限（基準 6.4・6.5） */
export const RANK_LIMIT = 10;

export type ScoreInput = {
  distanceMeters: number;
  storeGenres: readonly string[];
  /** その回の取得で選ばれた好み（登録の好みではない・基準 6.3 の「その回の」） */
  customerGenres: readonly string[];
};
export type Score = { distancePoints: number; genrePoints: number; total: number };

/** 距離点は 0m→60点・800m→0点 の直線（基準 6.2）。範囲の外の値が来ても 0〜60 に収める */
const distancePointsOf = (meters: number): number => {
  const raw = DISTANCE_POINTS_MAX * (1 - meters / SEARCH_RADIUS_METERS);
  return Math.min(DISTANCE_POINTS_MAX, Math.max(0, raw));
};

/** ジャンル点（基準 6.3）。好みが1つも選ばれていなければ中間の点 */
const genrePointsOf = (storeGenres: readonly string[], customerGenres: readonly string[]): number => {
  if (customerGenres.length === 0) return GENRE_POINTS_NO_PREFERENCE;
  return storeGenres.some((genre) => customerGenres.includes(genre)) ? GENRE_POINTS_MATCH : GENRE_POINTS_MISMATCH;
};

/** 店1つの点数（基準 6.1・6.2・6.3）。丸めない——同点の判定が丸め幅に依存しないため */
export const scoreStore = (input: ScoreInput): Score => {
  const distancePoints = distancePointsOf(input.distanceMeters);
  const genrePoints = genrePointsOf(input.storeGenres, input.customerGenres);
  return { distancePoints, genrePoints, total: distancePoints + genrePoints };
};

/** 並べ替えが見る店の姿（点数と、同点のときの順に要るものだけ） */
export type RankItem = {
  id: string;
  distanceMeters: number;
  storeGenres: readonly string[];
  /** 店の登録の時刻（ISO 8601 の文字列）。同点・同距離のときの順に使う */
  createdAt: string;
};
export type Ranked<T> = T & { score: number };

/** 店の登録の古さ。読めない値はいちばん新しい扱い（後ろへ回す）で、並びが崩れないようにする */
const registeredAt = (iso: string): number => {
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed;
};

/** 同じ文字列どうしで同じ答えになる比べ方（localeCompare は環境の言語データに依存しうるので使わない） */
const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * 点数の高い順に並べた上位10件（基準 6.4・6.5）。
 * 同点なら起点からの距離が近い順、さらに同じなら店の登録が古い順（要件4の基準 4.12 と同じ規則）。
 * 3つとも同じときは店の番号の順（AI判断。入力の並びに答えが左右されないため・基準 6.7）。
 *
 * 渡された配列は書き換えない（写しを作ってから並べ替える）。
 */
export const rankStores = <T extends RankItem>(items: readonly T[], customerGenres: readonly string[]): Array<Ranked<T>> =>
  items
    .map((item) => ({
      ...item,
      score: scoreStore({ distanceMeters: item.distanceMeters, storeGenres: item.storeGenres, customerGenres }).total,
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.distanceMeters - b.distanceMeters ||
        registeredAt(a.createdAt) - registeredAt(b.createdAt) ||
        compareIds(a.id, b.id),
    )
    .slice(0, RANK_LIMIT);
