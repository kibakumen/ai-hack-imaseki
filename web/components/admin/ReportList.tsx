"use client";

// 運営の通報の一覧（要件26の基準 26.6・26.7・26.8・26.9）。開いた時に入口を1回呼び、
// 返ってきた行をそのまま描く（新しい順に並べるのは入口の側・`usecases/adminReports`）。
//
// 行から店の詳細へ移れる（基準 26.7）——その画面に止める操作が在る（基準 25.4）。
// 応答に客の呼び名と電話番号が入っていないので、ここで隠す手当ては要らない（基準 26.8・28.2）。
//
// ⚠️ 通報が来たことの通知・対応の状況の管理・返事・自動の停止は作らない（要件26の補足・本人発案）。
//    当番が気づくのはこの画面を開いたとき（承知のうえの穴）。

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiCall, isFailure } from "../../lib/client/api";
import { dateTimeInJst } from "../ui/jstTime";

/** 入口の応答（`GET /api/admin/reports`）。形は検査していないので、在ることに頼らずに読む。 */
type ReportRow = { id: string; storeId: string; storeName: string; reason: string; at: string };

export const ReportList = () => {
  const [items, setItems] = useState<ReportRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const result = await apiCall<{ items: ReportRow[] }>("GET", "/api/admin/reports");
      if (alive) setItems(isFailure(result) ? [] : (result.items ?? []));
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (items === null) return <main aria-busy="true" />;

  return (
    <main>
      <h1>通報</h1>

      {items.length === 0 && <p data-testid="reports-empty">通報はまだありません。</p>}

      {items.length > 0 && (
        <ul>
          {items.map((report) => (
            <li key={report.id} data-testid={`row-${report.id}`}>
              <Link href={`/admin/stores/${report.storeId}`}>{report.storeName}</Link>
              <span>{dateTimeInJst(report.at)}</span>
              <p>{report.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
};

export default ReportList;
