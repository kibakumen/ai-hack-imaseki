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
import { callApi, isFailure, type ApiFailure, type ResponseOf } from "../../lib/client/api";
import { useLoad } from "../../lib/client/useLoad";
import { LoadView } from "../ui/LoadState";
import { dateTimeInJst } from "../ui/jstTime";

/** 入口の応答（`GET /api/admin/reports`）の1行。形は client/api が表（schemas/responses）で確かめてある。 */
type ReportRow = ResponseOf<"GET /api/admin/reports">["items"][number];

const loadReports = async (): Promise<ReportRow[] | ApiFailure> => {
  const result = await callApi("GET /api/admin/reports");
  return isFailure(result) ? result : result.items;
};

const isNoReport = (items: ReportRow[]): boolean => items.length === 0;

export const ReportList = () => {
  // 読めなかった（ログインが切れた・通信に失敗した）ときに「通報はまだありません」を出さない
  // ——この画面が通報に気づく唯一の入口なので、0件と取り違えると届いている通報を見落とす
  // （2026-09-25 監査の指摘 横断-01）。
  const { state, reload } = useLoad(loadReports, { isEmpty: isNoReport });

  return (
    <main>
      <h1>通報</h1>

      <LoadView state={state} onRetry={() => void reload()} empty={<p data-testid="reports-empty">通報はまだありません。</p>}>
        {(items) => (
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
      </LoadView>
    </main>
  );
};

export default ReportList;
