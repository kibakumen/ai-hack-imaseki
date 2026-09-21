"use client";

// 運営の数字の画面（要件33の基準 33.4・設計書「運営の画面」の数字）。開いた時に入口を1回呼び、
// 返ってきた数をそのまま並べる（数え方は入口の側・設計書「概要」の芯の1）。
//
// ⚠️ ここは読むだけの画面。押して何かが変わる操作は置かない（数字は記録から導かれる）。
// ⚠️ 客のデータ（電話番号・呼び名）は入口が返さないので、この画面にも出ない（基準 27.6・28.2）。
//
// 2026-09-21 タスク28（OrcaRouter の3点セット A-2）が「モデル別の表」（data-testid="by-model"・
// data-testid="fallback-count"）を足した。
// 2026-09-22 速成版（sprint/app/admin の AiMetricsSection）の磨き込みを移植（本人選択）:
//   モデル別の呼び出し件数・平均実費を、外部ライブラリなしの CSS 幅%の横棒グラフで、
//   数字の一覧より上（画面の最初のセクション）に出す。表（by-model）はそのまま残す。

import { useEffect, useState } from "react";
import { apiCall, isFailure, type ApiFailure } from "../../lib/client/api";
import { FormMessage } from "../ui/InputRefusal";
import styles from "./admin.module.css";

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
const usdOrDash = (value: number | null): string => (value === null ? "—" : usd(value));

const times = (count: number): string => `${count} 回`;

const MODEL_UNKNOWN_LABEL = "不明";
const modelLabel = (model: string | null): string => model ?? MODEL_UNKNOWN_LABEL;

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

/** 割合バー1本。外部ライブラリなしで、幅%だけで棒グラフ風に見せる（AI判断・上限を切ってから最低幅3%を保証）。 */
const Bar = ({ label, valueLabel, ratio }: { label: string; valueLabel: string; ratio: number }) => {
  const width = Math.max(3, Math.round(Math.min(1, Math.max(0, ratio)) * 100));
  return (
    <div className={styles.barRow}>
      <div className={styles.barLabel} title={label}>{label}</div>
      <div className={styles.barTrack}>
        <div className={styles.barFill} style={{ width: `${width}%` }} />
      </div>
      <div className={styles.barValue}>{valueLabel}</div>
    </div>
  );
};

/** モデル別（呼び出し件数・平均実費のグラフ＋詳細の表）。要件33の基準 33.4・タスク28。 */
const ByModelSection = ({ rows, fallbackCount }: { rows: ByModelRow[]; fallbackCount: number }) => {
  const maxCalls = Math.max(1, ...rows.map((r) => r.count));
  const maxCost = Math.max(0.0001, ...rows.map((r) => r.avgCostUsd ?? 0));

  return (
    <section>
      <h2>AI の実費と所要（モデル別）</h2>
      <p data-testid="fallback-count">受け皿が答えた件数: {fallbackCount}件</p>

      {rows.length > 0 && (
        <>
          <h3>呼び出し件数</h3>
          {rows.map((r) => (
            <Bar key={modelLabel(r.model)} label={modelLabel(r.model)} valueLabel={times(r.count)} ratio={r.count / maxCalls} />
          ))}

          <h3>平均実費</h3>
          {rows.map((r) => (
            <Bar key={modelLabel(r.model)} label={modelLabel(r.model)} valueLabel={usdOrDash(r.avgCostUsd)} ratio={(r.avgCostUsd ?? 0) / maxCost} />
          ))}
        </>
      )}

      <table className={styles.table} data-testid="by-model">
        <thead>
          <tr>
            {["モデル", "件数", "平均実費", "平均所要", "検査落ち", "受け皿"].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={modelLabel(r.model)}>
              <td>{modelLabel(r.model)}</td>
              <td>{r.count}</td>
              <td>{usdOrDash(r.avgCostUsd)}</td>
              <td>{milliseconds(r.avgDurationMs)}</td>
              <td>{percent(r.validationFailedRate)}</td>
              <td>{percent(r.fellBackRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};

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
        <>
          <ByModelSection rows={data.byModel} fallbackCount={data.fallbackCount} />

          <dl data-testid="metrics">
            {numbersOf(data).map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </main>
  );
};

export default Metrics;
