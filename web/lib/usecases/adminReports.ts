// 運営の通報の一覧（要件26の基準 26.6〜26.8）。並べ替えは SQL の側
// （設計書「どの判断をどこに置くか」）で、ここは応答の形に直すだけ。
//
// ⚠️ 応答に客の電話番号と呼び名を入れない（基準 26.8・28.2）。`repo/reports` がそもそも読まない。
// ⚠️ 絞り込みも件数の上限も持たない（要件26の補足「深くは作らない」・本人発案）。

import type { Deps } from "../ports";
import { listReportsForAdmin } from "../repo/reports";

export type AdminReportItem = {
  id: string;
  storeId: string;
  storeName: string;
  reason: string;
  at: string;
};

export const adminReports = async (deps: Deps): Promise<{ items: AdminReportItem[] }> => {
  const rows = await listReportsForAdmin(deps.db);
  return { items: rows.map(({ atIso, ...rest }) => ({ ...rest, at: atIso })) };
};
