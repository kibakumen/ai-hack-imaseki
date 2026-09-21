// テストの準備（vitest.config.ts の setupFiles にこのファイルを置く。実行者が設定を書く）。
// 1. fetch を「外へ出たら落とす」関数に差し替える（基準 31.3）。手元の loopback だけは通す（miniflare の内部通信のため）。
// 2. 着手済みで未完了のタスクに、その番号を名乗る受け入れ検査のブロックが0件なら例外を投げる（第7周の本人判断の受け皿）。
//    ブロックが別のタスクの番号を名乗って skip される抜け道を、静的な走査で塞ぐ。
import fs from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import { RUNS_DIR, taskStates } from "./_tasks";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 120_000 });

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let host = "";
  try {
    host = new URL(url).host;
  } catch {
    host = "";
  }
  if (host && LOCAL_HOST.test(host)) return realFetch(input as any, init);
  return Promise.reject(new Error(`受け入れ検査の中で外へ出る通信を止めました: ${url}（差し替え口の偽物を使うこと・基準 31.3）`));
}) as typeof fetch;

const HERE = path.dirname(new URL(import.meta.url).pathname);

const blocksByTask = (): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const file of fs.readdirSync(HERE)) {
    if (!/\.test\.tsx?$/.test(file)) continue;
    const text = fs.readFileSync(path.join(HERE, file), "utf8");
    for (const m of text.matchAll(/describeTask\(\s*["'](\d+(?:\.\d+)?)["']/g)) {
      counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
    }
  }
  return counts;
};

if (fs.existsSync(RUNS_DIR)) {
  const states = taskStates();
  const counts = blocksByTask();
  const missing: string[] = [];
  for (const file of fs.readdirSync(RUNS_DIR)) {
    const m = file.match(/^task-(\d+(?:\.\d+)?)\.json$/);
    if (!m) continue;
    const task = m[1];
    const state = states.get(task);
    if (!state || state.done || state.owner === "本人") continue;
    if (!(counts.get(task) ?? 0)) missing.push(`${task}（${state.title}）`);
  }
  if (missing.length) {
    throw new Error(
      `着手済みで未完了のタスクに、その番号を名乗る受け入れ検査のブロックが0件です: ${missing.join("、")}。` +
        `受け入れ検査は describeTask("<番号>", …) でそのタスクの番号を名乗る（設計書「受け入れ検査をタスクごとに走らせる」）`,
    );
  }
}
