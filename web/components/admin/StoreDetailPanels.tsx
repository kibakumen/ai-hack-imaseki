"use client";

// 運営の店の詳細の、読むだけの面（店の情報・書類とカード・止める前に見るもの・その店への通報・操作の履歴）。
// 操作（承認・取り消し・戻す・仮のパスワード・メモ）は StoreDetail・TempPasswordPanel・StoreReviewPanel が持つ。
//
// 2026-09-25 監査の指摘で足した面:
//   - 止める前に見るもの（公開中か・残りの枠・向かっている組数・通報・店の取り消しの回数）を見出しの近くに（運営-03・横断-09）
//   - その店への通報の件数と直近の3件（通報した客の短い印つき・運営-09）
//   - 運営の操作の履歴（誰が・いつ・なぜ・運営-01）
// ⚠️ 色の値はここに書かない（構造の検査 34）。全部 `admin.module.css` が持つ。

import Link from "next/link";
import type { ReactNode } from "react";
import type { AdminActionDto, AdminStoreDetailDto, ResponseOf } from "../../lib/client/api";
import { dateTimeInJst } from "../ui/jstTime";
import styles from "./admin.module.css";
import { TERMS } from "../../lib/domain/texts";

type StoreDetailDto = AdminStoreDetailDto;
type StoreReports = ResponseOf<"GET /api/admin/stores/:id">["reports"];

const EMPTY_TEXT = "まだありません";

/** 割合を百分率で（0.25 → 「25%」）。 */
const percent = (rate: number): string => `${Math.round(rate * 100)}%`;

/** 空の値は淡く出す（埋まっている情報と同じ重さで並べない）。 */
export const Empty = () => <span className={styles.noData}>{EMPTY_TEXT}</span>;

/** ジャンル・おすすめメニューは1つずつ札にする。無ければ空の印。 */
const Chips = ({ items }: { items: string[] }) =>
  items.length === 0 ? (
    <Empty />
  ) : (
    <span className={styles.chips}>
      {items.map((item) => (
        <span key={item} className={styles.chip}>
          {item}
        </span>
      ))}
    </span>
  );

const Budget = ({ store }: { store: StoreDetailDto }) =>
  store.budgetMin === null || store.budgetMax === null ? <Empty /> : <span className={styles.tabularNums}>{`${store.budgetMin}円〜${store.budgetMax}円`}</span>;

/** 店舗情報（項目の2列）。`dt`/`dd` を直接グリッドに並べるので桁が揃う。 */
export const StoreFacts = ({ store }: { store: StoreDetailDto }) => (
  <section className={styles.panel} aria-labelledby="store-facts-title">
    <h2 id="store-facts-title" className={styles.panelTitle}>
      {TERMS.storeProfile}
    </h2>
    <dl className={styles.facts}>
      <dt>住所</dt>
      <dd>{store.address ?? <Empty />}</dd>
      <dt>メールアドレス</dt>
      <dd>{store.email ? <a href={`mailto:${store.email}`}>{store.email}</a> : <Empty />}</dd>
      <dt>ホームページ</dt>
      <dd>
        {store.url ? (
          <a href={store.url} target="_blank" rel="noreferrer">
            {store.url}
          </a>
        ) : (
          <Empty />
        )}
      </dd>
      <dt>ジャンル</dt>
      <dd>
        <Chips items={store.genres} />
      </dd>
      <dt>おすすめメニュー</dt>
      <dd>
        <Chips items={store.menus} />
      </dd>
      <dt>予算の幅</dt>
      <dd>
        <Budget store={store} />
      </dd>
    </dl>
  </section>
);

type CheckRowProps = { testId: string; ready: boolean; readyLabel: string; missingLabel: string; children: ReactNode };

/** 書類とカードの1行。揃っていれば「承認済み」の色、まだなら「未承認」の色の印を付ける。 */
const CheckRow = ({ testId, ready, readyLabel, missingLabel, children }: CheckRowProps) => (
  <li data-testid={testId} className={styles.checkRow} data-ready={ready ? "true" : "false"}>
    <span className={styles.badge} data-status={ready ? "approved" : "pending"}>
      {ready ? readyLabel : missingLabel}
    </span>
    <span>{children}</span>
  </li>
);

export const StoreDocuments = ({ store }: { store: StoreDetailDto }) => (
  <section className={styles.panel} aria-labelledby="store-documents-title">
    <h2 id="store-documents-title" className={styles.panelTitle}>
      書類とカード
    </h2>
    <ul className={styles.checkList}>
      <CheckRow testId="license-status" ready={store.license} readyLabel="提出済み" missingLabel="未提出">
        {store.license ? (
          <a href={`/api/admin/stores/${store.id}/license`} target="_blank" rel="noreferrer">
            営業許可書を開く
          </a>
        ) : (
          "営業許可書はまだ上がっていません"
        )}
      </CheckRow>
      <CheckRow testId="card-status" ready={store.cardRegistered} readyLabel="登録済み" missingLabel="未登録">
        {store.cardRegistered ? "カードは登録済みです" : "カードはまだ登録されていません"}
      </CheckRow>
    </ul>
  </section>
);

/**
 * 止める前に見るもの（運営-03・横断-09）。見出しの近くに札で並べ、昼のピークに押して
 * 何組の確保を消すかを、押す前に目に入るようにする。
 */
export const StoreImpact = ({ store, reportCount }: { store: StoreDetailDto; reportCount: number }) => (
  <p data-testid="store-impact" className={styles.impactRow}>
    <span className={styles.badge} data-status={store.publishing ? "publishing" : undefined}>
      {store.publishing ? "オファー公開中" : "公開していません"}
    </span>
    {store.offerRemaining !== null && <span className={styles.stat}>{`残り ${store.offerRemaining} 枠`}</span>}
    <span className={styles.stat} data-strong={store.activeReservations > 0 ? "true" : "false"}>{`${store.activeReservations} 組が向かっています`}</span>
    <span className={styles.stat}>{`受け取り ${store.claims} 件`}</span>
    <span className={styles.stat} data-strong={reportCount > 0 ? "true" : "false"}>{`通報 ${reportCount} 件`}</span>
    <span className={styles.stat} data-strong={store.storeCancelled > 0 ? "true" : "false"}>{`店の取り消し ${store.storeCancelled} 回（${percent(store.storeCancelRate)}）`}</span>
  </p>
);

/** その店への通報（件数と直近の3件・運営-09）。印が同じ行は同じ客の通報。 */
export const StoreReportsPanel = ({ reports }: { reports: StoreReports }) => (
  <section data-testid="store-reports" className={styles.panel} aria-labelledby="store-reports-title">
    <h2 id="store-reports-title" className={styles.panelTitle}>
      この店への通報 {reports.count} 件
    </h2>
    {reports.latest.length === 0 ? (
      <p className={styles.noData}>通報はありません</p>
    ) : (
      <ul className={styles.plainList}>
        {reports.latest.map((report) => (
          <li key={report.id} className={styles.reportItem}>
            <span className={styles.cardMeta}>
              {dateTimeInJst(report.at)}・通報した人の印 <code>{report.reporter}</code>
            </span>
            <p className={styles.reportReason}>{report.reason}</p>
          </li>
        ))}
      </ul>
    )}
    {reports.count > reports.latest.length && <Link href="/admin/reports">通報の一覧で全部を見る</Link>}
  </section>
);

const ACTION_LABELS: Record<AdminActionDto["action"], string> = {
  approve: "承認",
  ban: "登録の取り消し",
  restore: "承認済みに戻す",
  temp_password: "仮のパスワードの発行",
  view_license: "営業許可書の閲覧",
  note: "メモ",
  acknowledge: "承認後の変更の確かめ",
};

/** 記録に添えた数を、読める1行にする（取り消した組数・通知した人数・連絡済みか）。 */
const detailText = (entry: AdminActionDto): string => {
  const d = entry.detail;
  if (entry.action === "ban") return `${d.cancelled ?? 0} 組を取り消し、${d.notified ?? 0} 人に通知`;
  if (entry.action === "note") return d.contacted ? "連絡済みにした" : "";
  if (entry.action === "view_license") return d.approved ? "承認した時点の許可書" : "";
  return "";
};

/** 運営の操作の履歴（誰が・いつ・なぜ・運営-01）。新しい順。 */
export const StoreHistory = ({ history }: { history: AdminActionDto[] }) => (
  <section data-testid="store-history" className={styles.panel} aria-labelledby="store-history-title">
    <h2 id="store-history-title" className={styles.panelTitle}>
      運営の操作の記録
    </h2>
    {history.length === 0 ? (
      <p className={styles.noData}>まだ記録がありません</p>
    ) : (
      <ol className={styles.plainList}>
        {history.map((entry) => (
          <li key={entry.id} className={styles.historyItem}>
            <strong>{ACTION_LABELS[entry.action]}</strong>
            <span className={styles.cardMeta}>
              {dateTimeInJst(entry.at)}・{entry.actorEmail ?? "（アカウントが消えています）"}
            </span>
            {detailText(entry) && <span className={styles.cardMeta}>{detailText(entry)}</span>}
            {entry.reason && <p className={styles.reportReason}>{entry.reason}</p>}
          </li>
        ))}
      </ol>
    )}
  </section>
);
