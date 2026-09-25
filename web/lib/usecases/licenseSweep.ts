// どの店の行からも指されていない営業許可書のファイルを消す掃除（2026-09-25 監査の指摘 安全-20 の案1 の残り・レビュー）。
//
// 許可書を消す手続き（上げ直し・取り下げ・止めたとき・usecases/license）は、表から先に外し、置き場から消せなかった
// ファイルは記録に残すだけだった。店主の氏名と住所が載りうるので、どこからも指されなくなったファイルはここで消す。
//
//   - **上げている途中のファイルを消さない**: 上げる手続きは、置き場に置いてから表を新しい鍵へ書き換える。その間の
//     ファイルは表から指されていない。鍵に置いた時刻（`licenses/<店の番号>/<ミリ秒>-<乱数>`）を入れてあるので、
//     置いてから1時間たったものだけを消す。時刻の無い古い形の鍵は、この直しより前に置いたもの＝十分に古いとみなす
//   - 一覧を先に読み、表をあとで読む（一覧のあとに上がったファイルは一覧に無いので消さない）
//   - 走らせ方: 定期の仕組み（Cron）を持たないので、許可書の操作（上げる・取り下げる・止めて消す）のあとに
//     `deps.defer`（本番は ctx.waitUntil）へ預けて応答のあとに走らせる。1日に1回まで（連打の抑止の表 rate_counters）。
//     預ける口が無い場面（受け入れ検査）と、一覧を出せない置き場（`files.list` の無い口）では走らせない。

import type { Deps } from "../ports";
import { hitRateCounter } from "../repo/rateCounters";
import { findReferencedLicenseKeys } from "../repo/stores";

/** 許可書の鍵の前置き（`licenses/<店の番号>/…`） */
export const LICENSE_KEY_PREFIX = "licenses/";
/** 上げている途中とみなす長さ（置いてから表を書き換えるまでは数秒。十分に長く取る・AI判断） */
const IN_FLIGHT_GRACE_MS = 60 * 60 * 1000;
/** 掃除の間引き（1日に1回・AI判断） */
const SWEEP_KEY = "upkeep:license-orphans";
const SWEEP_WINDOW_MS = 24 * 60 * 60 * 1000;
/** 鍵の3つ目の区切りの頭の、置いた時刻（ミリ秒・13桁） */
const PLACED_AT = /^licenses\/[^/]+\/(\d{13})-/;

/** 鍵に入れた置いた時刻。古い形（時刻の無い鍵）は null。 */
const placedAtMs = (key: string): number | null => {
  const match = PLACED_AT.exec(key);
  return match ? Number(match[1]) : null;
};

/** 鍵の2つ目の区切り（店の番号）。記録に残すため。 */
const storeIdOfKey = (key: string): string => key.split("/")[1] ?? "";

/** 1つの鍵について、消してよいか（指されていない・置いてから十分にたった） */
const isOrphan = (key: string, referenced: ReadonlySet<string>, cutoffMs: number): boolean => {
  if (referenced.has(key)) return false;
  const placed = placedAtMs(key);
  return placed === null || placed < cutoffMs;
};

/** 掃除を1回（1日に1回まで）。例外は外へ出さない——落ちても許可書の操作には関わらせず、記録に1行残す。 */
export const runLicenseSweep = async (deps: Deps): Promise<void> => {
  const list = deps.files.list?.bind(deps.files);
  if (!list) return;
  try {
    const now = deps.clock.now();
    const hit = await hitRateCounter(deps.db, SWEEP_KEY, { nowIso: now.toISOString(), windowMs: SWEEP_WINDOW_MS, limit: 1 });
    if (hit.count > 1) return;
    const keys = await list(LICENSE_KEY_PREFIX);
    const referenced = await findReferencedLicenseKeys(deps.db);
    const orphans = keys.filter((key) => isOrphan(key, referenced, now.getTime() - IN_FLIGHT_GRACE_MS));
    for (const key of orphans) {
      await deps.files.delete(key);
      deps.logger.log({ event: "license_orphan_deleted", id: storeIdOfKey(key) });
    }
  } catch {
    deps.logger.log({ event: "license_sweep_failed" });
  }
};

/** 応答のあとに掃除を走らせる（預ける口 deps.defer があるときだけ。無ければ走らせない＝応答を待たせない）。 */
export const scheduleLicenseSweep = (deps: Deps): void => {
  if (deps.defer) deps.defer(runLicenseSweep(deps));
};
