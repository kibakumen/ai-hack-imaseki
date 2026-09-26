"use client";

// 運営の店の一覧の1枚（2026-09-25 監査の指摘 運営-10 で一覧から分けた）。
// 店名・状態・公開中の印・住所・メールアドレスに加えて、並び替えの元になる数（登録日・受け取り・予算・残り枠）と
// 店が取り消した回数（横断-09）を小さな札で出し（退会した店は状況の札を「退会済み」にする・2026-09-26）、今選んでいる並びの元の札を目立たせる——並べた結果が
// 正しいかを、カードを見て確かめられるようにする。承認後に変更あり（運営-02）・連絡済み（運営-05）の印も出す。
// ⚠️ 色の値はここに書かない（構造の検査 34）。全部 `admin.module.css` が持つ。

import Link from "next/link";
import type { AdminStoreRowDto } from "../../lib/client/api";
import { dateTimeInJst } from "../ui/jstTime";
import styles from "./admin.module.css";
import { TERMS, WITHDRAWN_STORE_LABEL } from "../../lib/domain/texts";

export type SortKey = "created_desc" | "claims_desc" | "price_asc" | "remaining_desc";

type StoreRow = AdminStoreRowDto;
type StoreStatus = StoreRow["status"];

const STATUS_LABELS: Record<StoreStatus, string> = {
  pending: "未承認",
  approved: "承認済み",
  banned: TERMS.storeBanned,
};

/** 日付だけ（"YYYY/M/D HH:MM" の日付の部分）。 */
const dateOnly = (iso: string): string => dateTimeInJst(iso).split(" ")[0] ?? "";

const percent = (rate: number): string => `${Math.round(rate * 100)}%`;

type StatProps = { testId: string; active?: boolean; strong?: boolean; children: string };

const Stat = ({ testId, active = false, strong = false, children }: StatProps) => (
  <span data-testid={testId} className={styles.stat} data-active={active ? "true" : "false"} data-strong={strong ? "true" : "false"}>
    {children}
  </span>
);

type Props = { store: StoreRow; sortKey: SortKey; href: string };

export const StoreCard = ({ store, sortKey, href }: Props) => (
  <li data-testid={`row-${store.id}`} className={styles.card}>
    <div className={styles.cardHead}>
      <Link href={href}>{store.name}</Link>
      <span className={styles.badge} data-status={store.status}>
        {store.withdrawnAt ? WITHDRAWN_STORE_LABEL : STATUS_LABELS[store.status]}
      </span>
      {store.publishing && (
        <span className={styles.badge} data-status="publishing">
          オファー公開中
        </span>
      )}
      {store.changedSinceApproval && (
        <span className={styles.badge} data-status="pending">
          承認後に変更あり
        </span>
      )}
      {store.status === "pending" && store.contacted && <span className={styles.badge}>連絡済み</span>}
    </div>
    <span className={styles.cardMeta}>{store.address ?? "住所はまだありません"}</span>
    <span className={styles.cardMeta}>{store.email ?? "メールアドレスはまだありません"}</span>
    <span className={styles.statRow}>
      <Stat testId="stat-created" active={sortKey === "created_desc"}>{`登録 ${dateOnly(store.createdAt)}`}</Stat>
      <Stat testId="stat-claims" active={sortKey === "claims_desc"}>{`受け取り ${store.claims} 件`}</Stat>
      <Stat testId="stat-budget" active={sortKey === "price_asc"}>{store.budgetMin === null ? "予算 未設定" : `予算 ${store.budgetMin}円〜`}</Stat>
      <Stat testId="stat-remaining" active={sortKey === "remaining_desc"}>{store.offerRemaining === null ? "公開中のオファーなし" : `残り ${store.offerRemaining} 枠`}</Stat>
      {store.storeCancelled > 0 && <Stat testId="stat-store-cancel" strong>{`店の取り消し ${store.storeCancelled} 回（${percent(store.storeCancelRate)}）`}</Stat>}
    </span>
  </li>
);
