"use client";

// 運営の数字の画面（要件33の基準 33.4・設計書「運営の画面」の数字）。開いた時に入口を1回呼び、
// 返ってきた数をそのまま並べる（数え方は入口の側・設計書「概要」の芯の1）。
//
// ⚠️ ここは読むだけの画面。押して何かが変わる操作は置かない（数字は記録から導かれる）。
// ⚠️ 客のデータ（電話番号・呼び名）は入口が返さないので、この画面にも出ない（基準 27.6・28.2）。

import { useEffect, useState } from "react";
import { apiCall, isFailure, type ApiFailure } from "../../lib/client/api";
import { FormMessage } from "../ui/InputRefusal";

/** モデル別の表の1行（第4周の追記・タスク28 が表を描く）。 */
type ByModelRow = {
  model: string | null;
  count: number;
  avgCostUsd: number | null;
  avgDurationMs: number;
  validationFailedRate: number;
  fellBackRate: number;
};

type MetricsResponse = {
  ai: { calls: number; avgCostUsd: number; avgDurationMs: number; succeeded: number; failed: number };
  fetch: { count: number; avgDurationMs: number; aiUsed: number; fellBack: number };
  reservations: { total: number; expiredRate: number };
  byModel: ByModelRow[];
  fallbackCount: number;
};

/**
 * 割合を百分率で出す（0.3 → 「30%」）。
 * **必ず丸める**——0.3 * 100 は JavaScript では 30.000000000000004 になり、そのまま出すと桁が溢れる。
 */
const percent = (rate: number): string => `${Math.round(rate * 100)}%`;

const milliseconds = (ms: number): string => `${Math.round(ms)} ミリ秒`;

/** 1回あたりの実費はドルの小さい値なので、4桁まで出す（0.0012 が 0.00 に丸まらないように・AI判断）。 */
const usd = (value: number): string => `$${value.toFixed(4)}`;

const times = (count: number): string => `${count} 回`;

/** 画面に並べる数字（要件33の基準 33.4 が読めることを求めているもの）。 */
const numbersOf = (data: MetricsResponse): Array<{ label: string; value: string }> => [
  { label: "AI の呼び出し", value: times(data.ai.calls) },
  { label: "AI の実費（1回あたりの平均）", value: usd(data.ai.avgCostUsd) },
  { label: "AI の所要時間（平均）", value: milliseconds(data.ai.avgDurationMs) },
  { label: "AI が答えた", value: times(data.ai.succeeded) },
  { label: "AI が倒れた", value: times(data.ai.failed) },
  { label: "取得の回数", value: times(data.fetch.count) },
  { label: "取得の所要時間（平均）", value: milliseconds(data.fetch.avgDurationMs) },
  { label: "AI を使った取得", value: times(data.fetch.aiUsed) },
  { label: "点数順に倒れた取得", value: times(data.fetch.fellBack) },
  { label: "確保の数", value: `${data.reservations.total} 件` },
  { label: "確保のうち自動で取り消された割合", value: percent(data.reservations.expiredRate) },
];

export const Metrics = () => {
  const [data, setData] = useState<MetricsResponse | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const result = await apiCall<MetricsResponse>("GET", "/api/admin/metrics");
      if (!alive) return;
      if (isFailure(result)) {
        setFailure(result);
        setData(null);
        return;
      }
      setData(result);
      setFailure(null);
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main>
      <h1>数字</h1>

      <FormMessage failure={failure} />

      {/* 数字が揃ってから印を付ける——取る前から在ると、読む側が空の画面を「取れた」と読んでしまう。 */}
      {data && (
        <dl data-testid="metrics">
          {numbersOf(data).map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {/*
        ⚠️ タスク28（OrcaRouter の3点セット A-2）がここへ「モデル別の表」を足す（設計書「運営の画面」の数字の節）:
           上の数字の下に、受け皿が答えた件数の1行（data-testid="fallback-count"）と、
           `data.byModel` を行にした表（data-testid="by-model"・`model` が null の行は「不明」）。
           表の中身は data.byModel と data.fallbackCount に既に入って来ている（型は上の ByModelRow）。
      */}
    </main>
  );
};

export default Metrics;
