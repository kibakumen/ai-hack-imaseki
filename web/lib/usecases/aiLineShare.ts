// 回線ごとの AI の取り分（2026-09-26 本人選択・安全-03 の残り・要件30の補足）。
//
// 1つの接続元（回線）が、その日（日本時間）にアプリ全体の1日の AI の回数上限の2割（`AI_LINE_DAILY_CALL_LIMIT`）を使ったら、
// その回線からの取得では紹介文の AI を呼ばずに決まった文へ倒す。店の選定の AI は取り分で止めず、アプリ全体の上限
// （usecases/aiBudget）にだけ従う——ただし選定の1回も、その回線が使った1回として数える。
//
// 数えは連打の抑止と同じ表（rate_counters）の1行を、日本時間の日ごと・回線ごとの鍵で **AI を呼ぶ直前に1回ずつ、
// 1つの文で** 足す（repo/rateCounters の `hitRateCounter`・原子的）。足したあとの回数が取り分を超えていれば呼ばない。
// 「今日の合計を読んでから呼ぶ」形にすると、同じ回線から同時に来た取得がどれも「まだ残っている」を読んで全部呼ぶ。
// 窓は2日にして、その日のうちに数え直しが起きないようにする（鍵が日ごとに替わるので、前の日の行は読まれない）。
//
// ⚠️ 数えるのは回数だけで、実費の額は回線ごとに数えない（AI判断）。実費は呼び出しが返るまで分からず、額で数えると
//    「呼んだあとに足す」形になって同時の呼び出しを止められない。額の天井はアプリ全体の `AI_DAILY_BUDGET_USD` が持つ。
// ⚠️ 接続元の分からない要求（手元の開発で cf-connecting-ip が無い）は数えない——連打の抑止の接続元ごとの規則と同じ扱い。
// ⚠️ 取り分を超えた回も数は増える（窓の始まりは動かない）。その回線はその日のうちは超えたままなので、害は無い。

import { ipCountingUnit } from "../domain/clientAddress";
import type { Deps } from "../ports";
import { hitRateCounter } from "../repo/rateCounters";
import { AI_LINE_DAILY_CALL_LIMIT } from "../schemas/limits";
import { startOfJstDayIso } from "./aiBudget";

const COUNTER_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

/** その回線のその日の AI の数えを、1回ぶん足してから「呼んでよいか」を返す口。 */
export type AiLineMeter = { take: () => Promise<boolean> };

/** 回線（生の接続元を数える単位へ丸めたもの）と、その時刻を含む日本時間の1日の数えの鍵。 */
export const aiLineDailyKey = (ip: string, now: Date): string => `aiLineDaily:${ipCountingUnit(ip)}:${startOfJstDayIso(now)}`;

/**
 * その接続元の AI の取り分の口。接続元が分からなければ null（数えない）。
 * 取り分を超えた最初の1回だけ記録に残す（運営が後から気づけるように・`ai_daily_budget_reached` と同じ置き方）。
 */
export const aiLineMeter = (deps: Deps, ip: string | null): AiLineMeter | null => {
  if (!ip) return null;
  return {
    take: async () => {
      const now = deps.clock.now();
      const counted = await hitRateCounter(deps.db, aiLineDailyKey(ip, now), { nowIso: now.toISOString(), windowMs: COUNTER_WINDOW_MS, limit: AI_LINE_DAILY_CALL_LIMIT });
      if (counted.count <= AI_LINE_DAILY_CALL_LIMIT) return true;
      if (counted.count === AI_LINE_DAILY_CALL_LIMIT + 1) deps.logger.log({ event: "ai_line_share_reached" });
      return false;
    },
  };
};
