"use client";

// 公開中のオファーの「今日の動き」（2026-09-21 の本人の指摘「配信カードの右側に折れ線グラフを置いて
// 2カラムにしたい」）。速成版 `sprint/app/store/_components/OfferViz.tsx` の作り方を移した——
// 外部の図の部品は足さず、素の SVG の折れ線1本で描く。
//
// ⚠️ **描くのは画面が自分で見た値だけ**。入口は時間帯ごとの数を返さないので、無いものを補わない。
//    店のホームは30秒ごとに取り直すので、その**残りの変わり目を並べたものが線になる**
//    （画面を開いている間の記録・開き直すと空から始まる）。1点しか無い間は点だけを出す。
//
// ⚠️ 点を足すのは**ホームを取り直した時**（StoreHome の `recordTrend`）であって、描くときではない。
//    描く途中や effect の中で状態を変えると、描き直しが連鎖する（lint の set-state-in-effect）。

export type TrendPoint = { at: number; received: number };

const WIDTH = 280;
const HEIGHT = 96;
const PAD_X = 6;
const PAD_Y = 10;
/** 溜めすぎないための上限（30秒ごと・変わり目だけなので十分に足りる） */
const MAX_POINTS = 60;

/** その時点で受け取られた組数（残りが分からない時は 0）。 */
export const receivedOf = (capacity: number, remaining: number): number => Math.max(0, capacity - remaining);

/**
 * 取り直した中身から点を足す。**値が変わった時だけ**足し、オファーが無くなったら畳む。
 * 純粋に前の並びから次の並びを作る（呼ぶ側が状態に入れる）。
 */
export const appendTrend = (prev: TrendPoint[], offer: { capacity: number; remaining: number } | null, at: number): TrendPoint[] => {
  if (offer === null) return prev.length === 0 ? prev : [];
  const received = receivedOf(offer.capacity, offer.remaining);
  const last = prev[prev.length - 1];
  if (last !== undefined && last.received === received) return prev;
  return [...prev, { at, received }].slice(-MAX_POINTS);
};

const clockOf = (at: number): string => {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

type Props = { capacity: number; remaining: number; points: TrendPoint[] };

export const OfferTrend = ({ capacity, remaining, points }: Props) => {
  const received = receivedOf(capacity, remaining);
  const top = Math.max(1, capacity);
  const toY = (v: number) => HEIGHT - PAD_Y - (v / top) * (HEIGHT - PAD_Y * 2);
  const stepX = points.length > 1 ? (WIDTH - PAD_X * 2) / (points.length - 1) : 0;
  const receivedLine = points.map((p, i) => `${PAD_X + i * stepX},${toY(p.received)}`).join(" ");
  const capacityLine = `${PAD_X},${toY(capacity)} ${WIDTH - PAD_X},${toY(capacity)}`;
  const ratio = capacity > 0 ? Math.min(1, received / capacity) : 0;
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <div className="store-chart">
      <span className="store-note">今日の動き（この画面を開いてから）</span>

      <dl className="store-chart__legend">
        <div className="store-fact">
          <dt className="store-fact__label">受け取られた</dt>
          <dd className="store-fact__value">{received}</dd>
        </div>
        <div className="store-fact">
          <dt className="store-fact__label">配信数</dt>
          <dd className="store-fact__value">{capacity}</dd>
        </div>
      </dl>

      <div className="store-progress">
        <div className="store-progress__track">
          <div className="store-progress__bar" style={{ width: `${Math.round(ratio * 100)}%` }} />
        </div>
        <span>{Math.round(ratio * 100)}%</span>
      </div>

      <svg className="store-chart__svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label="受け取られた数の移り変わり">
        <polyline className="store-chart__line store-chart__line--capacity" points={capacityLine} />
        {points.length > 1 ? (
          <polyline className="store-chart__line store-chart__line--received" points={receivedLine} />
        ) : (
          <circle className="store-chart__dot" cx={PAD_X} cy={toY(received)} r={3} />
        )}
      </svg>

      <div className="store-chart__axis">
        <span>{first === undefined ? "" : clockOf(first.at)}</span>
        <span>{last === undefined ? "" : clockOf(last.at)}</span>
      </div>
    </div>
  );
};

export default OfferTrend;
