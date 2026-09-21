// 受け入れ検査のブロックは、それを実現するタスクの番号を名乗る（設計書「受け入れ検査をタスクごとに走らせる」）。
// 走るかどうかは、進行役が record.mjs start で作る着手の記録 `.dev/runs/v2/task-<番号>.json` の有無で決める。
// 記録のフォルダそのものが無い手元（他のメンバー・提出前の確かめ）では全部走る。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe } from "vitest";

export const REPO = fileURLToPath(new URL("../../../", import.meta.url));
export const RUNS_DIR = path.join(REPO, ".dev", "runs", "v2");
export const TASKS_MD = path.join(REPO, "docs", "specs", "v2", "tasks.md");

/** 着手の記録のフォルダが無ければ「全部走る」 */
export const isStarted = (task: string): boolean =>
  !fs.existsSync(RUNS_DIR) || fs.existsSync(path.join(RUNS_DIR, `task-${task}.json`));

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
