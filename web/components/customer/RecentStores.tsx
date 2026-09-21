"use client";

// 「最近行った店」（要件26の基準 26.11・26.13・26.16・26.17）。開いた時に入口を1回呼び、
// 返ってきた行をそのまま描く（どれを出すか・どの順かの判断は入口の側）。
//
// 行が持つのは**店名・完了済みにした日時・通報ボタンの3つだけ**（基準 26.17）——コード・住所・
// ホームページの URL は出さない。それらを見返すのは過去の受け取りの見返し（要件8の基準 8.11・タスク30）。

import { useEffect, useState } from "react";
import { apiCall, isFailure } from "../../lib/client/api";
import { dateTimeInJst } from "../ui/jstTime";
import type { ReportTarget } from "./ReportForm";

/** 入口の応答（`GET /api/customer/recent`）。形は検査していないので、在ることに頼らずに読む。 */
type RecentItem = { reservationId: string; storeId: string; storeName: string; completedAt: string };

type Props = { onReport: (target: ReportTarget) => void };

export const RecentStores = ({ onReport }: Props) => {
  const [items, setItems] = useState<RecentItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const result = await apiCall<{ items: RecentItem[] }>("GET", "/api/customer/recent");
      // 取れなかったときは「1件も無い」として描く（この一覧は通報への入口で、止める理由が無い）。
      if (alive) setItems(isFailure(result) ? [] : (result.items ?? []));
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (items === null) return <section aria-busy="true" />;

  return (
    <section aria-label="最近行った店">
      <h2>最近行った店</h2>

      {items.length === 0 && <p data-testid="recent-empty">最近行ったお店はまだありません。</p>}

      {items.length > 0 && (
        <ul>
          {items.map((item) => (
            <li key={item.reservationId} data-testid={`row-${item.reservationId}`}>
              <span>{item.storeName}</span>
              <span>{dateTimeInJst(item.completedAt)}</span>
              <button type="button" data-testid="btn-report" onClick={() => onReport({ storeId: item.storeId, storeName: item.storeName })}>
                通報する
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default RecentStores;
