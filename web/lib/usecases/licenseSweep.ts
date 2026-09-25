// どの店の行からも指されていない営業許可書のファイルを消す掃除（2026-09-25 監査の指摘 安全-20 の案1 の残り・レビュー）。
//
// 許可書を消す手続き（上げ直し・取り下げ・止めたとき・usecases/license）は、表から先に外し、置き場から消せなかった
// ファイルは記録に残すだけだった。店主の氏名と住所が載りうるので、どこからも指されなくなったファイルはここで消す。
//
//   - **上げている途中のファイルを消さない**: 上げる手続きは、置き場に置いてから表を新しい鍵へ書き換える。その間の
//     ファイルは表から指されていない。鍵に置いた時刻（`licenses/<店の番号>/<ミリ秒>-<乱数>`）を入れてあるので、
//     置いてから1時間たったものだけを消す。時刻の無い古い形の鍵は、この直しより前に置いたもの＝十分に古いとみなす
//   - 一覧を先に読み、表をあとで読む（一覧のあとに上がったファイルは一覧に無いので消さない）
//   - 走らせ方: 定期の仕組み（Cron）を持たないので、許可書の操作（上げる・取り下げる・止めて消す）と客の取得のあとに
//     `deps.defer`（本番は ctx.waitUntil）へ預けて応答のあとに走らせる。1日に1回まで（連打の抑止の表 rate_counters）。
//     預ける口が無い場面（受け入れ検査）では走らせない。一覧を出せない置き場（`files.list` の無い口）では、指されていない
//     ファイルの掃除だけを飛ばす。
//
// 承認されないまま置かれた許可書の保管期限（2026-09-26 のレビュー・安全-20 の案1 の残り・AI判断）も、ここで同じ回に見る。
// 承認を断る操作は置かない（要件25の基準 25.3）ので、上げてから30日（`PENDING_LICENSE_RETENTION_MS`）たっても承認されない
// 店の許可書は、審査が終わったものとして表から外してファイルを消す。店は上げ直せばまた審査に入る。

import type { Deps } from "../ports";
import { hitRateCounter } from "../repo/rateCounters";
import { clearPendingStoreLicense, findReferencedLicenseKeys, findStalePendingLicenses } from "../repo/stores";
import { PENDING_LICENSE_RETENTION_MS } from "../schemas/limits";

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

/** 1回に消す、期限を過ぎた許可書の数（D1 と置き場の往復を1回の手入れで抑える・AI判断） */
const EXPIRE_PER_RUN = 20;

/**
 * 承認されないまま期限を過ぎた許可書を、表から外してファイルを消す。表から外すのは読んだ鍵のままのときだけ
 * （その間に上げ直された・承認された許可書を消さない）。承認の写しが同じ鍵を指していればファイルは残す。
 */
const expireStalePendingLicenses = async (deps: Deps, now: Date): Promise<void> => {
  const stale = await findStalePendingLicenses(deps.db, new Date(now.getTime() - PENDING_LICENSE_RETENTION_MS).toISOString(), EXPIRE_PER_RUN);
  for (const license of stale) {
    if (!(await clearPendingStoreLicense(deps.db, license.id, license.licenseKey))) continue;
    if (license.licenseKey !== license.approvedLicenseKey) await deps.files.delete(license.licenseKey);
    deps.logger.log({ event: "license_expired_unapproved", id: license.id });
  }
};

/** どの店の行からも指されていないファイルを消す（一覧を出せる置き場のときだけ）。 */
const deleteOrphans = async (deps: Deps, now: Date): Promise<void> => {
  const list = deps.files.list?.bind(deps.files);
  if (!list) return;
  const keys = await list(LICENSE_KEY_PREFIX);
  const referenced = await findReferencedLicenseKeys(deps.db);
  const orphans = keys.filter((key) => isOrphan(key, referenced, now.getTime() - IN_FLIGHT_GRACE_MS));
  for (const key of orphans) {
    await deps.files.delete(key);
    deps.logger.log({ event: "license_orphan_deleted", id: storeIdOfKey(key) });
  }
};

/** 掃除を1回（1日に1回まで）。例外は外へ出さない——落ちても許可書の操作や取得には関わらせず、記録に1行残す。 */
export const runLicenseSweep = async (deps: Deps): Promise<void> => {
  try {
    const now = deps.clock.now();
    const hit = await hitRateCounter(deps.db, SWEEP_KEY, { nowIso: now.toISOString(), windowMs: SWEEP_WINDOW_MS, limit: 1 });
    if (hit.count > 1) return;
    await expireStalePendingLicenses(deps, now);
    await deleteOrphans(deps, now);
  } catch {
    deps.logger.log({ event: "license_sweep_failed" });
  }
};

/** 応答のあとに掃除を走らせる（預ける口 deps.defer があるときだけ。無ければ走らせない＝応答を待たせない）。 */
export const scheduleLicenseSweep = (deps: Deps): void => {
  if (deps.defer) deps.defer(runLicenseSweep(deps));
};
