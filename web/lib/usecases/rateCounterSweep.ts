// 数えの表 rate_counters の片付け（2026-09-26 独立したレビューの指摘・AI判断）。
//
// 連打の抑止・回線ごとの AI の取り分・地図の1日の上限・端末の印は、どれも rate_counters に鍵ごとの1行を置く。
// 鍵に接続元や日付を含む行（`aiLineDaily:<IP>:<日>`・`fetchIp:<IP>` など）は、窓が明けても誰も消さず、接続元と日の数だけ
// 増え続けていた。1日1回の定期実行（lib/scheduled）で、窓の始まりが「いちばん長い窓」（RATE_COUNTER_RETENTION_MS）より
// 古い行を消す——その行はもうどの規則の窓にも入っておらず、消しても数えは変わらない。

import type { Deps } from "../ports";
import { deleteRateCountersBefore } from "../repo/rateCounters";
import { RATE_COUNTER_RETENTION_MS } from "../schemas/limits";

/** いちばん長い窓より古い数えの行を消す。消した行があれば記録に1行残す。例外はそのまま外へ出す（定期実行の失敗として残す）。 */
export const sweepRateCounters = async (deps: Deps): Promise<void> => {
  const beforeIso = new Date(deps.clock.now().getTime() - RATE_COUNTER_RETENTION_MS).toISOString();
  const count = await deleteRateCountersBefore(deps.db, beforeIso);
  if (count > 0) deps.logger.log({ event: "rate_counters_swept", count });
};
