"use client";

// 公開中のオファーの「今日の動き」（本人の第2回の指摘「数字カードがでかすぎるので、配信数のうちどれくらいが
// 受け取られたかをプログレスバーでコンパクトに。結果に出た数は、時刻ごとの推移がわかる折れ線グラフに」）。
// 外部の図の部品は足さず、素の SVG の折れ線で描く。
//
// 2026-09-25 監査の指摘 店-15 で作り直した: それまでの線は、画面が30秒ごとに取り直した「配信数−残り」を画面の中に
// 溜めたもので、結果に出た回数を描いておらず、取り消しや期限切れで下がり、開き直すと空に戻り、横軸も時刻に
// 比例していなかった。今は店のホームの応答の `trend`（15分ごとの結果に出た回数と受け取り）を**そのまま**描く——
// 区切りは等間隔なので、横軸は時刻に比例する。数えるのは入口の側で、ここは並べるだけ。

import type { ResponseOf } from "../../lib/client/api";
import { timeInJst } from "../ui/jstTime";

/** 15分ぶんの1区切り（応答の形の正本は schemas/responses の storeHome.trend）。 */
export type TrendBucket = ResponseOf<"GET /api/store/home">["trend"][number];

const WIDTH = 280;
const HEIGHT = 96;
const PAD_X = 6;
const PAD_Y = 10;

type Series = "shown" | "received";

const sumOf = (trend: readonly TrendBucket[], key: Series): number => trend.reduce((total, bucket) => total + bucket[key], 0);

/** 値を縦の位置にする（上が大きい）。 */
const yOf = (value: number, top: number): number => HEIGHT - PAD_Y - (value / top) * (HEIGHT - PAD_Y * 2);

/** 区切りの並びを折れ線の点にする（等間隔＝時刻に比例）。 */
const pointsOf = (trend: readonly TrendBucket[], key: Series, top: number): string => {
  const stepX = trend.length > 1 ? (WIDTH - PAD_X * 2) / (trend.length - 1) : 0;
  return trend.map((bucket, i) => `${PAD_X + i * stepX},${yOf(bucket[key], top)}`).join(" ");
};

/** 2本の線（区切りが1つだけなら点）。 */
const TrendLines = ({ trend, top }: { trend: readonly TrendBucket[]; top: number }) => {
  if (trend.length > 1) {
    return (
      <>
        <polyline className="store-chart__line store-chart__line--shown" points={pointsOf(trend, "shown", top)} />
        <polyline className="store-chart__line store-chart__line--received" points={pointsOf(trend, "received", top)} />
      </>
    );
  }
  const only = trend[0];
  return (
    <>
      <circle className="store-chart__dot store-chart__dot--shown" cx={PAD_X} cy={yOf(only.shown, top)} r={3} />
      <circle className="store-chart__dot store-chart__dot--received" cx={PAD_X + 8} cy={yOf(only.received, top)} r={3} />
    </>
  );
};

type Props = { capacity: number; remaining: number; trend: readonly TrendBucket[] };

export const OfferTrend = ({ capacity, remaining, trend }: Props) => {
  // 受け取られて枠を押さえている数（配信数 − 残り）。プログレスバーだけに使う
  const held = Math.max(0, capacity - remaining);
  const percent = capacity > 0 ? Math.round(Math.min(1, held / capacity) * 100) : 0;
  const top = Math.max(1, ...trend.map((bucket) => Math.max(bucket.shown, bucket.received)));
  const first = trend[0];
  const last = trend[trend.length - 1];

  return (
    <div className="store-chart" data-testid="offer-trend">
      <div className="store-progress">
        <span className="store-progress__label">
          受け取られた {held}/{capacity} 組
        </span>
        <div className="store-progress__track">
          <div className="store-progress__bar" style={{ width: `${percent}%` }} />
        </div>
        <span>{percent}%</span>
      </div>

      <dl className="store-chart__legend">
        <div className="store-chart__key store-chart__key--shown">
          <dt>結果に出た</dt>
          <dd data-testid="trend-shown-total">{sumOf(trend, "shown")} 回</dd>
        </div>
        <div className="store-chart__key store-chart__key--received">
          <dt>受け取り</dt>
          <dd data-testid="trend-received-total">{sumOf(trend, "received")} 組</dd>
        </div>
      </dl>

      {trend.length === 0 ? null : (
        <svg className="store-chart__svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label="15分ごとの、結果に出た回数と受け取りの移り変わり">
          <TrendLines trend={trend} top={top} />
        </svg>
      )}

      <div className="store-chart__axis">
        <span>{first === undefined ? "" : timeInJst(first.at)}</span>
        <span>15分ごと</span>
        <span>{last === undefined ? "" : timeInJst(last.at)}</span>
      </div>
    </div>
  );
};

export default OfferTrend;
