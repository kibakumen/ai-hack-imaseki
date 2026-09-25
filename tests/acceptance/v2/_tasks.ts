// 受け入れ検査のブロックは、それを実現するタスクの番号を名乗る（設計書「受け入れ検査をタスクごとに走らせる」）。
// 走るかどうかは、進行役が record.mjs start で作る着手の記録 `.dev/runs/v2/task-<番号>.json` の有無で決める。
//
// ⚠️ **絞りは環境変数 `ACCEPTANCE_TASK_GATE=1` を立てた実行（/dev の実装の段）だけに効く**（2026-09-25 設計-02）。
// 以前は「記録のフォルダが在れば絞る」だったため、並列の作業ツリーで実装したタスクの着手記録が
// main の `.dev` に無く、手元の `vitest run` で約70件（横断の安全の検査を含む）が**黙って飛んでいた**。
// 立てなければ全部走る——飛ばすかどうかを、置き忘れたファイルではなく実行する側の意思で決める。
// 立てるのは /dev のゲート（`dev.config.json` の `gate.test` が `env ACCEPTANCE_TASK_GATE=1 pnpm exec vitest run`）。
// 手元の `pnpm exec vitest run`・README の手順・提出の前の確かめは立てないので、全部走る。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe } from "vitest";

export const REPO = fileURLToPath(new URL("../../../", import.meta.url));
export const RUNS_DIR = path.join(REPO, ".dev", "runs", "v2");
export const TASKS_MD = path.join(REPO, "docs", "specs", "v2", "tasks.md");

/** タスクごとの絞りを効かせる実行か（/dev のゲート＝`dev.config.json` の `gate.test` が `ACCEPTANCE_TASK_GATE=1` を立てる） */
export const taskGateEnabled = (): boolean => process.env.ACCEPTANCE_TASK_GATE === "1" && fs.existsSync(RUNS_DIR);

/** 絞りが効いていなければ「全部走る」。効いていれば、着手の記録が在るタスクだけ走る */
export const isStarted = (task: string): boolean => !taskGateEnabled() || fs.existsSync(path.join(RUNS_DIR, `task-${task}.json`));

/** tasks.md を読んで、タスク番号 → 完了かどうか・名前・担当（AI／本人） */
export const taskStates = (): Map<string, { done: boolean; title: string; owner: string }> => {
  const map = new Map<string, { done: boolean; title: string; owner: string }>();
  if (!fs.existsSync(TASKS_MD)) return map;
  let current: string | null = null;
  for (const line of fs.readFileSync(TASKS_MD, "utf8").split(/\r?\n/)) {
    const m = line.match(/^- \[( |x|X)\]\s+(\d+(?:\.\d+)?)\.?\s+(.+)$/);
    if (m) {
      current = m[2];
      map.set(current, { done: m[1].toLowerCase() === "x", title: m[3].trim(), owner: "" });
      continue;
    }
    const owner = line.match(/_担当[:：]\s*(.+?)_\s*$/);
    if (owner && current) map.get(current)!.owner = owner[1].trim();
  }
  return map;
};

/**
 * describeTask(タスク番号, 名前, 本体) ＝ 着手していないタスクのブロックは飛ばす。
 * 受け入れ検査のファイルの最上位のブロックは全部これを通す（構造の検査 structure.test.ts が見張る）。
 */
export const describeTask = (task: string, name: string, body: () => void): void => {
  const fn = isStarted(task) ? describe : describe.skip;
  fn(`[タスク ${task}] ${name}`, body);
};
