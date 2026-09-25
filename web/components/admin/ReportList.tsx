"use client";

// 運営の通報の一覧（要件26の基準 26.6・26.7・26.8・26.9）。開いた時に入口を1回呼び、
// 返ってきた行をそのまま描く（新しい順に並べるのは入口の側・`usecases/adminReports`）。
//
// 行から店の詳細へ移れる（基準 26.7）——その画面に止める操作が在る（基準 25.4）。
// 応答に客の呼び名と電話番号が入っていないので、ここで隠す手当ては要らない（基準 26.8・28.2）。
//
// ⚠️ 通報が来たことの通知・対応の状況の管理・返事・自動の停止は作らない（要件26の補足・本人発案）。
//    当番が気づくのはこの画面を開いたとき（承知のうえの穴）。
//
// 2026-09-25 監査の指摘で直した:
//   - 行ごとに、通報した人の短い印（同じ印は同じ客）と、その店への通報の数を出す（運営-09）。
//     いたずらの連打か、別々の客からの本物の通報かを、止める前に見分けるため
//   - 店の一覧と同じカードの面で1件ずつ区切る（理由は500字まで入るので、区切りが見えないと読み違える・運営-12）

import Link from "next/link";
import { callApi, isFailure, type AdminReportDto, type ApiFailure } from "../../lib/client/api";
import { useLoad } from "../../lib/client/useLoad";
import { LoadView } from "../ui/LoadState";
import { dateTimeInJst } from "../ui/jstTime";
import styles from "./admin.module.css";

/** 入口の応答（`GET /api/admin/reports`）の1行。形は client/api が表（schemas/responses）で確かめてある。 */
type ReportRow = AdminReportDto;

const loadReports = async (): Promise<ReportRow[] | ApiFailure> => {
  const result = await callApi("GET /api/admin/reports");
  return isFailure(result) ? result : result.items;
};

const isNoReport = (items: ReportRow[]): boolean => items.length === 0;

const ReportCard = ({ report }: { report: ReportRow }) => (
  <li data-testid={`row-${report.id}`} className={styles.card}>
    <div className={styles.cardHead}>
      <Link href={`/admin/stores/${report.storeId}`}>{report.storeName}</Link>
      <span className={styles.stat} data-strong={report.storeReportCount > 1 ? "true" : "false"}>{`この店への通報 ${report.storeReportCount} 件`}</span>
    </div>
    <span className={styles.cardMeta}>
      {dateTimeInJst(report.at)}・通報した人の印 <code>{report.reporter}</code>
    </span>
    <p className={styles.reportReason}>{report.reason}</p>
  </li>
);

export const ReportList = () => {
  // 読めなかった（ログインが切れた・通信に失敗した）ときに「通報はまだありません」を出さない
  // ——この画面が通報に気づく唯一の入口なので、0件と取り違えると届いている通報を見落とす
  // （2026-09-25 監査の指摘 横断-01）。
  const { state, reload } = useLoad(loadReports, { isEmpty: isNoReport });

  return (
    <main className={styles.page}>
      <h1>通報</h1>
      <p className={styles.actionLead}>新しい順です。通報した人の印が同じ行は、同じお客さまからの通報です。</p>

      <LoadView state={state} onRetry={() => void reload()} empty={<p data-testid="reports-empty">通報はまだありません。</p>}>
        {(items) => (
          <ul className={styles.cardList}>
            {items.map((report) => (
              <ReportCard key={report.id} report={report} />
            ))}
          </ul>
        )}
      </LoadView>
    </main>
  );
};

export default ReportList;
