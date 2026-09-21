"use client";

// 店の実績の画面（要件23・設計書「店の画面」の下のナビの「実績」）。開いた時に入口を1回呼び、
// 返ってきた数をそのまま並べる（数え方は入口の側・設計書「概要」の芯の1）。
//
// ⚠️ ここは読むだけの画面。押して何かが変わる操作は置かない。数字の取り直しも画面を開いた時だけ
//    （要件23の補足: 店が張り付く画面ではない）。
// ⚠️ 客のデータ（呼び名・電話番号）は入口が返さないので、この画面にも出ない（基準 27.6・28.2）。

import { useEffect, useState } from "react";
import { apiCall, isFailure, type ApiFailure } from "../../lib/client/api";
import { FormMessage } from "../ui/InputRefusal";
import { dateTimeInJst } from "../ui/jstTime";

/** 取り消された数の内訳（基準 23.6）。 */
type CancelledBreakdown = { total: number; customer: number; expired: number; store: number; admin: number };

type ResultRow = {
  offerId: string;
  publishedAt: string;
  shown: number;
  received: number;
  completed: number;
  cancelled: CancelledBreakdown;
};

type ResultsResponse = { items: ResultRow[] };

/** 表の見出し（基準 23.1 の4つ ＋ 並びの元になる公開の時刻）。 */
const HEADINGS = ["公開", "出た回数", "受け取られた数", "完了済み", "取り消し（内訳）"] as const;

const EMPTY_MESSAGE = "まだ実績がありません。オファーを公開すると、出た回数や受け取られた数がここに並びます。";

/** 内訳は1つの欄に収める（誰の都合で取り消されたかを店が読み分けるためのもの・要件23の補足）。 */
const cancelledLabel = (cancelled: CancelledBreakdown): string =>
  `${cancelled.total}（客 ${cancelled.customer}・期限 ${cancelled.expired}・店 ${cancelled.store}・運営 ${cancelled.admin}）`;

export const ResultsTable = () => {
  const [items, setItems] = useState<ResultRow[] | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const result = await apiCall<ResultsResponse>("GET", "/api/store/results");
      if (!alive) return;
      if (isFailure(result)) {
        setFailure(result);
        setItems(null);
        return;
      }
      setItems(result.items);
      setFailure(null);
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main>
      <h1>実績</h1>

      <FormMessage failure={failure} />

      {/* 取れてから出す——取る前から「まだ実績がありません」を出すと、読めていないのか0件なのかが区別できない。 */}
      {items?.length === 0 && <p data-testid="results-empty">{EMPTY_MESSAGE}</p>}

      {items !== null && items.length > 0 && (
        <table>
          <thead>
            <tr>
              {HEADINGS.map((heading) => (
                <th key={heading} scope="col">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.offerId} data-testid={`row-${item.offerId}`}>
                <td>{dateTimeInJst(item.publishedAt)}</td>
                <td>{item.shown}</td>
                <td>{item.received}</td>
                <td>{item.completed}</td>
                <td>{cancelledLabel(item.cancelled)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
};

export default ResultsTable;
