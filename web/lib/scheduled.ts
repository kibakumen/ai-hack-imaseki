// 定期実行（Cloudflare の Cron Triggers）と手続きをつなぐ橋（2026-09-26 本人選択）。
//
// 呼ぶのは web/worker.mjs の scheduled だけ（wrangler.jsonc の triggers.crons が1日1回起こす）。要求の入口の橋
// （lib/entry.ts）と同じく、束縛から Deps を組んで手続きを呼ぶだけで、判断は持たない。
//
// 今走らせるのは2つ:
//   ①Google で直した店の座標の手入れ（usecases/googleUpkeep の runScheduledGoogleUpkeep）。
//     Service Specific Terms 6.3.1 は Geocoding の緯度と経度を連続30日までに限る。手入れは客の取得のついでにも走るが、
//     客が来ない期間があると30日を超えて残りうるので、定期実行で毎日必ず消す（しきい値は29日＝上限 − 間隔1日）。
//   ②数えの表 rate_counters の片付け（usecases/rateCounterSweep・2026-09-26 レビュー）。接続元×日の鍵の行が増え続けないよう、
//     いちばん長い窓より古い行を消す。
// 片方が落ちても、もう片方は走らせる（落ちた方の例外をあとで投げ直す）。
//
// ⚠️ 例外は外へ出す（scheduled の失敗として Cloudflare の記録に残す）。要求の入口と違い、黙って倒す相手がいない。

import { createDeps } from "./adapters/deps";
import type { RawEnv } from "./adapters/env";
import { createLogger } from "./adapters/logger";
import type { Deps } from "./ports";
import { runScheduledGoogleUpkeep } from "./usecases/googleUpkeep";
import { sweepRateCounters } from "./usecases/rateCounterSweep";

/** 定期実行で走らせる手続き（上から順に。片方が落ちても次を走らせる） */
const SCHEDULED_JOBS: ReadonlyArray<(deps: Deps) => Promise<void>> = [runScheduledGoogleUpkeep, sweepRateCounters];

/** 手続きを全部走らせ、落ちたものがあれば最初の例外を投げ直す。 */
const runAll = async (deps: Deps): Promise<void> => {
  const errors: unknown[] = [];
  for (const job of SCHEDULED_JOBS) {
    try {
      await job(deps);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) throw errors[0];
};

/**
 * 定期実行を1回。`makeDeps` は検査で偽物を渡すための差し替え口（既定は実物の組み立て）。
 * 組み立て（束縛が無い）か手入れが落ちたら、記録に1行残して投げ直す。
 */
export const runScheduledJobs = async (env: RawEnv, makeDeps: (env: RawEnv) => Deps = createDeps): Promise<void> => {
  const logger = createLogger();
  try {
    const deps = makeDeps(env);
    await runAll(deps);
  } catch (error) {
    logger.log({ event: "scheduled_failed", errorKind: error instanceof Error ? error.name : "unknown" });
    throw error;
  }
};
