// 運営の通報の一覧（要件26の基準 26.6〜26.8）。並べ替えは SQL の側
// （設計書「どの判断をどこに置くか」）で、ここは応答の形に直すだけ。
//
// ⚠️ 応答に客の電話番号と呼び名を入れない（基準 26.8・28.2）。`repo/reports` がそもそも読まない。
// ⚠️ 絞り込みも件数の上限も持たない（要件26の補足「深くは作らない」・本人発案）。
//
// 2026-09-25 監査の指摘 運営-09 の案A・案B（勧める案が無いので「深くは作らない」の方針に合う2つ）:
//   - 行ごとに、通報した客の**短い印**（客の内部の番号のハッシュの先頭6字）を出す。同じ客の連打を見分けるため
//     （要件26の補足が客の識別子を残す理由）。内部の番号そのもの・Cookie の値は出さない
//   - 行ごとに、その店への通報の全部の数を出す（同じ店に何件来ているか）

import type { Deps } from "../ports";
import { countReportsOfStore, listReportsForAdmin, listReportsOfStoreForAdmin, type AdminReportRow } from "../repo/reports";
import { ADMIN_STORE_REPORTS_LATEST, REPORTER_MARK_LENGTH } from "../schemas/limits";

export type AdminReportItem = {
  id: string;
  storeId: string;
  storeName: string;
  reason: string;
  at: string;
  /** 通報した客の短い印（同じ客なら同じ印） */
  reporter: string;
  /** その店への通報の全部の数 */
  storeReportCount: number;
};

/**
 * 客の内部の番号を、運営の画面に出せる短い印にする。用途の名前を前に付けてからハッシュする
 * ——ほかの場面で同じ番号のハッシュを出すことになっても、印と突き合わせられないように。
 */
const reporterMark = async (deps: Deps, customerId: string): Promise<string> =>
  (await deps.hasher.sha256Hex(`admin-report-reporter:${customerId}`)).slice(0, REPORTER_MARK_LENGTH);

const toItem = async (deps: Deps, row: AdminReportRow): Promise<AdminReportItem> => ({
  id: row.id,
  storeId: row.storeId,
  storeName: row.storeName,
  reason: row.reason,
  at: row.atIso,
  reporter: await reporterMark(deps, row.customerId),
  storeReportCount: row.storeReportCount,
});

export const adminReports = async (deps: Deps): Promise<{ items: AdminReportItem[] }> => {
  const rows = await listReportsForAdmin(deps.db);
  return { items: await Promise.all(rows.map((row) => toItem(deps, row))) };
};

/** 店の詳細に出す、その店への通報（件数と直近の数件・運営-03・運営-09）。 */
export type StoreReports = { count: number; latest: Array<Pick<AdminReportItem, "id" | "reason" | "at" | "reporter">> };

export const storeReportsForAdmin = async (deps: Deps, storeId: string): Promise<StoreReports> => {
  const [count, rows] = await Promise.all([countReportsOfStore(deps.db, storeId), listReportsOfStoreForAdmin(deps.db, storeId, ADMIN_STORE_REPORTS_LATEST)]);
  const latest = await Promise.all(rows.map(async (row) => ({ id: row.id, reason: row.reason, at: row.atIso, reporter: await reporterMark(deps, row.customerId) })));
  return { count, latest };
};
