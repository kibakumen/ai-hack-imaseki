// アプリ全体の1日の AI の上限（2026-09-25 監査の指摘 安全-03 の「選ぶ部分」の第一の案・AI判断）。
//
// 連打の抑止は客ごと・接続元ごとに数えるので、客を何人も作られると AI の1日の予算（OrcaRouter の鍵）を
// 使い切られうる。使い切られると、その日は全員が AI の失敗（打ち切りまでの待ち）を経て点数順に倒れる。
// ここでは、その日（日本時間）の ai_calls の実費か回数が上限に届いたら、AI を呼ぶ前に点数順へ倒す。
// 倒れ方は AI の失敗と同じ（取得は点数順・紹介文は決まった文）なので、客の画面の作りは変わらない。

import type { Deps } from "../ports";
import { sumAiCallsSince } from "../repo/aiBudget";
import { AI_DAILY_BUDGET_USD, AI_DAILY_CALL_LIMIT } from "../schemas/limits";

/** 日本時間は UTC より9時間進んでいる（夏時間は無い） */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** その時刻を含む、日本時間の1日の始まり（UTC の ISO 8601）。 */
export const startOfJstDayIso = (now: Date): string => {
  const jst = now.getTime() + JST_OFFSET_MS;
  return new Date(jst - (jst % DAY_MS) - JST_OFFSET_MS).toISOString();
};

/** 今日（日本時間）の AI の予算がまだ残っているか。届いていたら記録に1行残す（運営が後から気づけるように）。 */
export const aiBudgetLeft = async (deps: Deps): Promise<boolean> => {
  const total = await sumAiCallsSince(deps.db, startOfJstDayIso(deps.clock.now()));
  const left = total.costUsd < AI_DAILY_BUDGET_USD && total.calls < AI_DAILY_CALL_LIMIT;
  if (!left) deps.logger?.log({ event: "ai_daily_budget_reached" });
  return left;
};
