// ログの出口。console を呼ぶただ1つの場所（設計書「ファイル構成の計画」・構造の検査が見張る）。
// 何を出すかは呼び出し側（usecases・defineRoute）が決める。ここは console へ渡すだけで判断しない。
// 個人データ（呼び名・電話番号・場所の文字など）を渡さないのは呼び出し側の責務（基準の割り当てに従う）。

import type { Logger } from "../ports";

export const createLogger = (): Logger => ({
  log: (entry) => {
    console.log(JSON.stringify(entry));
  },
});
