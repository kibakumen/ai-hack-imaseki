// 決定論の絞り込み（要件5）。距離・受け取れる状態・人数・予算の4つだけで決める。
// AI は1回も呼ばない（基準 5.7）。同じ入力なら毎回同じ集合を同じ順で返す（基準 5.8）——
// 入力の並びをそのまま残し、入力の配列を書き換えない。
//
// 入力の型にクーポン（特記事項）は無い（要件16の基準 16.8）。店の姿に無いものは絞り込みに使いようがない。

import { distanceMeters, SEARCH_RADIUS_METERS, type Point } from "./geo";

/**
 * その回の取得の条件。
 * 好みのジャンルは**絞り込みには使わない**（基準 5.6）。点数づけ（domain/score）だけが使うので、
 * ここでは受け取らない——受け取ると「使い忘れ」と「使ってしまう」の両方が起こりうる。
 */
export type FilterInput = {
  origin: Point;
  party: number;
  /** 未指定（null）なら予算で候補を除かない（基準 5.5）。0 は「0円まで」であって未指定ではない */
  budgetMax: number | null;
};

/** 絞り込みが見る店の姿（クーポンを持たない・基準 16.8） */
export type FilterStore = Point & {
  id: string;
  /** そのオファーが受け入れる人数の上限（基準 5.3。公開中に変えたあとは変えたあとの値・基準 19.7） */
  partyMax: number;
  budgetMin: number;
  budgetMax: number;
  /** オファーが受け取れる状態か（用語の節。判断の正本は domain/offer.isReceivable と repo/sqlFragments） */
  receivable: boolean;
  /** 点数づけが使う（絞り込みは見ない・基準 5.6）。呼ぶ側が同じ行をそのまま score へ渡せるように持たせてある */
  genres: readonly string[];
};

/**
 * 候補を決める（基準 5.1〜5.6）。渡された店の並びを保ったまま、条件に合うものだけを返す。
 *
 * 渡された行をそのまま返すので、呼ぶ側が足した欄（店名・おすすめメニューなど）は失われない。
 */
export const filterCandidates = <T extends FilterStore>(input: FilterInput, stores: readonly T[]): T[] =>
  stores.filter((store) => {
    if (!store.receivable) return false; // 基準 5.2（受け取れる状態の店だけ）
    if (input.party > store.partyMax) return false; // 基準 5.3（同じなら残し、1多いと落とす）
    if (input.budgetMax !== null && store.budgetMin > input.budgetMax) return false; // 基準 5.4・5.5
    return distanceMeters(input.origin, store) <= SEARCH_RADIUS_METERS; // 基準 5.1
  });
