// 受け入れ検査が import せずに使う場面の準備を、globalThis に置く（2026-09-22 タスク25 が足した）。
//
// **なぜ要るか**: 直下の `acceptance-globals.d.ts` は、この5つを「どの検査からも名前で呼べる」と
// **型の上では**宣言している。ところが値を置く側がどこにも無く、実際に import を省いていた
// `r22-push.test.ts` は `ReferenceError: approvedStore is not defined` で落ちていた
// ——型は通るのに実行で落ちる、宣言と実体のずれ。宣言の側は受け入れ検査ではないので、
// 落ちている実体の側をここで足して揃える。
//
// ⚠️ `tests/acceptance/**` は凍結されているので、ここは**その外**に置く（`vitest.config.ts` の
//    `setupFiles` から `_setup.ts` と一緒に読む）。中身は `_fakes.ts` の関数をそのまま置くだけで、
//    振る舞いは1つも変えない。
//
// ⚠️ `_fakes.ts` の読み込みは軽い（wrangler も web/ の中身も、呼ばれた時に動的に読む）ので、
//    画面の部品だけを見る検査に重さが乗ることはない。
import { approvedStore, fetchOffers, publishOffer, receive, registerCustomer } from "./acceptance/v2/_fakes";

Object.assign(globalThis, { approvedStore, fetchOffers, publishOffer, receive, registerCustomer });
