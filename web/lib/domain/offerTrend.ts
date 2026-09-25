// 公開中のオファーの「今日の動き」（2026-09-25 監査の指摘 店-15・本人の指摘「結果に出た数は、時刻ごとの推移が
// わかる折れ線グラフに」）。副作用なし・時計も引数で受け取る。
//
// それまでの線は、画面が30秒ごとに取り直した「配信数−残り」を画面の中に溜めたもので、結果に出た回数は描いて
// おらず、取り消しや期限切れで下がり、開き直すと空に戻り、横軸も時刻に比例していなかった。今は入口が
// **15分ごとの「結果に出た回数」と「受け取り」**を返し、画面はそれを時刻の軸に並べるだけにする。

/** 1区切りの長さ（15分・値は AI判断——12時間の枠で最大49点に収まる） */
export const TREND_BUCKET_MS = 15 * 60 * 1000;

/** 1区切りぶん。`at` は区切りの始まり（ISO 8601） */
export type TrendBucket = { at: string; shown: number; received: number };

/** 区切りの番号ごとの数（repo が GROUP BY で数えた行）。 */
export type BucketCount = { bucket: number; count: number };

/** 区切りの起点——公開した時刻を15分の頭へ切り下げる（18:07 に公開したら 18:00 から）。 */
export const trendOrigin = (publishedAt: Date): Date => new Date(Math.floor(publishedAt.getTime() / TREND_BUCKET_MS) * TREND_BUCKET_MS);

const countAt = (rows: readonly BucketCount[], bucket: number): number => rows.find((row) => row.bucket === bucket)?.count ?? 0;

/**
 * 起点から今の区切りまでを、数の無い区切りも 0 で埋めて並べる（線が時刻に比例するように）。
 * 今が起点より前（時計の食い違い）なら、起点の1区切りだけ。
 */
export const trendSeries = ({
  origin,
  now,
  shown,
  received,
}: {
  origin: Date;
  now: Date;
  shown: readonly BucketCount[];
  received: readonly BucketCount[];
}): TrendBucket[] => {
  const last = Math.max(0, Math.floor((now.getTime() - origin.getTime()) / TREND_BUCKET_MS));
  return Array.from({ length: last + 1 }, (_, bucket) => ({
    at: new Date(origin.getTime() + bucket * TREND_BUCKET_MS).toISOString(),
    shown: countAt(shown, bucket),
    received: countAt(received, bucket),
  }));
};
