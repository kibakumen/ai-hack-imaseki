// 通報を受け付ける（要件26の基準 26.2・26.4・26.18）。形と長さの検査は入口のスキーマ
// （schemas/report.ts）が済ませている。ここが見るのは2つ——理由が空でないことと、通報してよい店か。
//
// 保存するのは4つ（どの店か・理由・日時・客の内部の番号・基準 26.4）。**Cookie の生の値は保存しない**
// ——指すのは `customers.id` で、Cookie の値と1対1の内部の番号（設計書「客の識別子」）。

import { recentWindowStart } from "../domain/report";
import { tokenFromBytes } from "../domain/token";
import type { Deps } from "../ports";
import { canReportStore, insertReport } from "../repo/reports";
import type { ReportInput } from "../schemas/report";
import { ID_BYTES } from "../schemas/limits";

/**
 * 断りの2つ。
 * - `invalid_input` … 理由が空か空白だけ（基準 26.2。項目は `reason`・理由は `required`）
 * - `report_not_allowed` … その客が行っていない店（基準 26.18）
 */
export type ReportResult =
  | { ok: true }
  | { ok: false; status: 400; error: { kind: "invalid_input"; fields: Array<{ name: string; reason: "required" }> } }
  | { ok: false; status: 409; error: { kind: "report_not_allowed" } };

export const reportStore = async (deps: Deps, customerId: string, input: ReportInput): Promise<ReportResult> => {
  // 前後の空白を落としてから数える（空白だけは「入れていない」と同じ・基準 26.2）。
  const reason = input.reason.trim();
  if (reason === "") return { ok: false, status: 400, error: { kind: "invalid_input", fields: [{ name: "reason", reason: "required" }] } };

  const now = deps.clock.now();
  const allowed = await canReportStore(deps.db, {
    customerId,
    storeId: input.storeId,
    nowIso: now.toISOString(),
    recentFromIso: recentWindowStart(now).toISOString(),
  });
  // 無い店も、行っていない店と同じ断り（店が在るかどうかを客に教えない・AI判断）。
  if (!allowed) return { ok: false, status: 409, error: { kind: "report_not_allowed" } };

  await insertReport(deps.db, {
    id: tokenFromBytes(deps.rng.bytes(ID_BYTES)),
    storeId: input.storeId,
    customerId,
    reason,
    atIso: now.toISOString(),
  });
  return { ok: true };
};
