// 時計（差し替え口 Clock）の実物。`lib/domain` は時刻を引数で受け取るだけなので、
// 「今」と「待つ」を知っているのはこの1ファイル（設計書「依存の向き」）。
//
// ⚠️ Workers の `Date.now()` は、外への通信を1度もしていない間は進まない（同じ値を返す）。
// 要件が見る時刻の差は、いつも D1 への書き込みか外の呼び出しを挟んでいるので支障は無い。

import type { Clock } from "../ports";

export const createClock = (): Clock => ({
  now: () => new Date(),
  after: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
});
