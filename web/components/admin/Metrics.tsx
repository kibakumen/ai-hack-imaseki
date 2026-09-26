"use client";

// 運営の数字の画面（要件33の基準 33.4・設計書「運営の画面」の数字）。開いた時に入口を1回呼び、
// 返ってきた数をそのまま並べる（数え方は入口の側・設計書「概要」の芯の1）。
//
// ⚠️ ここは読むだけの画面。押して記録が変わる操作は置かない（数字は記録から導かれる）。
// ⚠️ 客のデータ（電話番号・呼び名）は入口が返さないので、この画面にも出ない（基準 27.6・28.2）。
//
// 2026-09-21 タスク28 が「モデル別の表」（data-testid="by-model"・"fallback-count"）を足した。
// 2026-09-22 速成版の磨き込みを移植（本人選択）: モデル別の横棒グラフ。用途別の実費内訳（本人の指示）。
//
// 2026-09-25 監査の指摘で直した:
//   - いちばん上に「今日（日本時間）」と「全期間」の実費の合計を出す。いつの時点の数かと「読み直す」を置く（運営-08）
//   - 設計書どおり「点数順で出した割合」「予備のモデルが答えた割合」を出し、各数字に1行の説明を付ける（運営-08）
//   - 候補0件で AI を呼ばなかった取得を、点数順で出した取得と別の行にする（不具合-10）
//   - 内部の言い方（「倒れた」「受け皿」）を画面に出さない（運営-08）

import { callApi, type AdminMetricsDto, type ApiFailure } from "../../lib/client/api";
import { useLoad } from "../../lib/client/useLoad";
import { LoadView } from "../ui/LoadState";
import { timeInJst } from "../ui/jstTime";
import styles from "./admin.module.css";

// 応答の型は、サーバーと同じ定義（schemas/responses の表）から作る——手で写さない（2026-09-25 監査の指摘 設計-07）。
type MetricsResponse = AdminMetricsDto;

/** モデル別の表の1行（第4周の追記・タスク28 が表を描く）。 */
type ByModelRow = AdminMetricsDto["byModel"][number];

/** 用途別の1行（2026-09-22）。`purpose` は "select" | "pitch" | "pitch_eval"（下の PURPOSE_LABELS）。 */
type ByPurposeRow = NonNullable<AdminMetricsDto["byPurpose"]>[number];

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

/** 用途の語（repo/logs.ts の AiCallPurpose）を日本語の名前へ（本人の指示にある3つの言い方に合わせる）。 */
const PURPOSE_LABELS: Record<string, string> = { select: "店の選定", pitch: "紹介文の生成", pitch_eval: "紹介文の判定" };
const purposeLabel = (purpose: string): string => PURPOSE_LABELS[purpose] ?? purpose;

type Metric = { label: string; value: string; help: string };

/** 画面に並べる数字（要件33の基準 33.4 と設計書「運営の画面」の数字）。1つずつ何を数えたかを添える。 */
const numbersOf = (data: MetricsResponse): Metric[] => [
  { label: "店の選定の AI の呼び出し", value: times(data.ai.calls), help: "店を選ばせるために AI を呼んだ回数（紹介文の分は下の用途別に出します）。" },
  { label: "店の選定の実費（1回あたりの平均）", value: usd(data.ai.avgCostUsd), help: "実費が記録された呼び出しの平均。答えられなかった回は入れません。" },
  { label: "店の選定の所要時間（平均）", value: milliseconds(data.ai.avgDurationMs), help: "AI に頼んでから答えが返るまで。" },
  { label: "AI が答えた", value: times(data.ai.succeeded), help: "店の選定で、AI が答えを返した回数。" },
  { label: "AI が答えられなかった", value: times(data.ai.failed), help: "時間切れ・誤りなどで答えが返らなかった回数。その取得は点数順で出しました。" },
  { label: "取得の回数", value: times(data.fetch.count), help: "お客さまが「探す」を押した回数。" },
  { label: "取得の所要時間（平均）", value: milliseconds(data.fetch.avgDurationMs), help: "場所が決まってから、結果を返すまで。" },
  { label: "AI の選定を使った取得", value: times(data.fetch.aiUsed), help: "AI が選んだ順で結果を出した取得。" },
  { label: "点数順で出した取得", value: times(data.fetch.fellBack), help: "候補は在ったのに、AI が答えられず（その日の予算切れを含む）点数順で出した取得。" },
  { label: "点数順で出した割合", value: percent(data.fetch.fellBackRate), help: "候補の在った取得のうち、点数順で出した割合。" },
  { label: "候補が無く AI を呼ばなかった取得", value: times(data.fetch.noCandidates), help: "近くに出せるオファーが無かった取得。AI は呼ばない決まりで、点数順で出したのとは別に数えます。" },
  { label: "確保の数", value: `${data.reservations.total} 件`, help: "受け取られた確保の全部。" },
  { label: "店が「来店なしでキャンセル」した確保", value: `${data.storeCancels?.noShow ?? 0} 件`, help: `店がキャンセルした確保（${data.storeCancels?.total ?? 0} 件）のうち、来ないと判断してキャンセルし、枠を戻したもの。` },
  { label: "退会でキャンセルした確保", value: `${data.storeCancels?.withdrawn ?? 0} 件`, help: "店が退会したときに、向かっていたお客さまの確保をキャンセルしたもの。店が選んだキャンセルには数えません。" },
  { label: "確保のうち自動でキャンセルされた割合", value: percent(data.reservations.expiredRate), help: "もう終わった確保のうち、期限までに来店が無かった割合（向かっている途中の確保は入れません）。" },
  { label: "予備のモデルが答えた割合", value: percent(data.fallbackRate), help: "全部の呼び出しのうち、最初のモデルの代わりに予備のモデルが答えた割合。" },
];

/** 割合バー1本。外部ライブラリなしで、幅%だけで棒グラフ風に見せる（AI判断・上限を切ってから最低幅3%を保証）。 */
const Bar = ({ label, valueLabel, ratio }: { label: string; valueLabel: string; ratio: number }) => {
  const width = Math.max(3, Math.round(Math.min(1, Math.max(0, ratio)) * 100));
  return (
    <div className={styles.barRow}>
      <div className={styles.barLabel} title={label}>
        {label}
      </div>
      <div className={styles.barTrack}>
        <div className={styles.barFill} style={{ width: `${width}%` }} />
      </div>
      <div className={`${styles.barValue} ${styles.tabularNums}`}>{valueLabel}</div>
    </div>
  );
};

/** 呼び出しが1件も無いときに出す文（本人の指示: 0 の棒を並べない）。 */
const NoCallsYet = () => <p className={styles.noData}>まだ呼び出しがありません</p>;

/** いちばん上の実費の合計（運営-08）。「今日いくら使ったか」を最初に見せる。 */
const CostTotals = ({ data }: { data: MetricsResponse }) => (
  <dl data-testid="cost-totals" className={styles.summaryTiles}>
    <div className={styles.tile}>
      <dt className={styles.tileLabel}>今日（日本時間）の AI の実費</dt>
      <dd className={`${styles.tileValue} ${styles.tabularNums}`}>{usd(data.cost.todayUsd)}</dd>
      <dd className={styles.tileLabel}>{`${data.cost.todayCalls} 回・店の選定と紹介文の合計`}</dd>
    </div>
    <div className={styles.tile}>
      <dt className={styles.tileLabel}>全期間の AI の実費</dt>
      <dd className={`${styles.tileValue} ${styles.tabularNums}`}>{usd(data.cost.totalUsd)}</dd>
      <dd className={styles.tileLabel}>{`${data.cost.totalCalls} 回・店の選定と紹介文の合計`}</dd>
    </div>
  </dl>
);

/** モデル別（呼び出し件数・平均実費のグラフ＋詳細の表）。要件33の基準 33.4・タスク28。 */
const ByModelSection = ({ rows, fallbackCount, fallbackRate }: { rows: ByModelRow[]; fallbackCount: number; fallbackRate: number }) => {
  const maxCalls = Math.max(1, ...rows.map((r) => r.count));
  const maxCost = Math.max(0.0001, ...rows.map((r) => r.avgCostUsd ?? 0));

  return (
    <section>
      <h2>AI の実費と所要（実際に答えたモデル別）</h2>
      <p data-testid="fallback-count">
        予備のモデルが答えた件数: <span className={styles.tabularNums}>{fallbackCount}</span>件（{percent(fallbackRate)}）
      </p>

      {rows.length === 0 ? (
        <NoCallsYet />
      ) : (
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
            {["モデル", "件数", "平均実費", "平均所要", "検査落ち", "予備のモデル"].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={modelLabel(r.model)}>
              <td>{modelLabel(r.model)}</td>
              <td className={styles.tabularNums}>{r.count}</td>
              <td className={styles.tabularNums}>{usdOrDash(r.avgCostUsd)}</td>
              <td className={styles.tabularNums}>{milliseconds(r.avgDurationMs)}</td>
              <td className={styles.tabularNums}>{percent(r.validationFailedRate)}</td>
              <td className={styles.tabularNums}>{percent(r.fellBackRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};

/**
 * 用途別（店の選定／紹介文の生成／紹介文の判定）の実費内訳（2026-09-22・本人の指示）。
 * 横棒は実費の合計の割合で見せる——「その用途にいくら使ったか」がアピールになる工夫の中身。
 */
const ByPurposeSection = ({ rows }: { rows: ByPurposeRow[] }) => {
  const maxCost = Math.max(0.0001, ...rows.map((r) => r.totalCostUsd));

  return (
    <section>
      <h2>AI の実費の内訳（用途別）</h2>

      {rows.length === 0 ? (
        <NoCallsYet />
      ) : (
        <>
          {rows.map((r) => (
            <Bar key={r.purpose} label={purposeLabel(r.purpose)} valueLabel={usd(r.totalCostUsd)} ratio={r.totalCostUsd / maxCost} />
          ))}

          <table className={styles.table} data-testid="by-purpose">
            <thead>
              <tr>
                {["用途", "件数", "実費（合計）", "平均所要"].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.purpose}>
                  <td>{purposeLabel(r.purpose)}</td>
                  <td className={styles.tabularNums}>{r.count}</td>
                  <td className={styles.tabularNums}>{usd(r.totalCostUsd)}</td>
                  <td className={styles.tabularNums}>{milliseconds(r.avgDurationMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
};

const loadMetrics = async (): Promise<MetricsResponse | ApiFailure> => callApi("GET /api/admin/metrics");

export const Metrics = () => {
  const { state, reload } = useLoad(loadMetrics);

  return (
    <main className={styles.page}>
      <h1>数字</h1>

      {/* 数字が揃ってから印を付ける——取る前から在ると、読む側が空の画面を「取れた」と読んでしまう。 */}
      <LoadView state={state} onRetry={() => void reload()}>
        {(data) => (
          <>
            <p className={styles.toolbar}>
              <span data-testid="metrics-at" className={styles.count}>{`${timeInJst(data.at)} の時点の数です`}</span>
              <button type="button" data-testid="btn-reload-metrics" className={styles.quietBtn} onClick={() => void reload()}>
                読み直す
              </button>
            </p>
            <CostTotals data={data} />
            <ByModelSection rows={data.byModel} fallbackCount={data.fallbackCount} fallbackRate={data.fallbackRate} />
            {/* 古い形の応答は `byPurpose` を持たない——無ければ空として扱う（0件と同じ「まだ呼び出しがありません」表示）。 */}
            <ByPurposeSection rows={data.byPurpose ?? []} />

            <dl className={styles.metricsGrid} data-testid="metrics">
              {numbersOf(data).map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd className={styles.tabularNums}>{row.value}</dd>
                  <dd data-testid="metric-help" className={styles.metricHelp}>
                    {row.help}
                  </dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </LoadView>
    </main>
  );
};

export default Metrics;
