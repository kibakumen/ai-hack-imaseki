"use client";

// 予算の上限を押して選ぶチップ（2026-09-25 監査の指摘 客-15 の案A）。本人の第1回の指摘は
// 「予算も専用のフォームがあった方が入力しやすい」。素の数値欄だと、歩きながら打つ手間が残り、単位も読み取りにくい。
//
// 並べるのは「指定なし／〜1,000円／〜2,000円／〜3,000円／〜5,000円」（額は AI判断）。登録の値がこの中に
// 無ければ（前に数値欄で入れた額など）、その額のチップを足して選んでおく——登録の値を黙って丸めない（基準 3.13）。
// 声で入れた額（`VoiceInput`）がこの中に無いときも、その額のチップを足して選んでおく。
// 値は文字のまま持ち（空＝指定なし）、要求に載せる形へ直すのは `FetchForm` の `budgetToSend`。

import type { ApiFailure } from "../../lib/client/api";
import { BUDGET_MAX_MAX, BUDGET_MAX_MIN } from "../../lib/schemas/limits";
import { FieldMessage, fieldAria } from "../ui/InputRefusal";

/** よく使う額（1人あたり・円）。 */
const PRESETS: readonly number[] = [1000, 2000, 3000, 5000];

/** 金額は3桁ごとに区切って出す（読み違えを減らすための表示だけの整形）。 */
const yen = (amount: number): string => `〜${amount.toLocaleString("ja-JP")}円`;

/** よく使う額に無い正の整数か（足すチップの候補）。 */
const isExtra = (amount: number | null): amount is number => amount !== null && Number.isInteger(amount) && amount > 0 && !PRESETS.includes(amount);

/** 並べる額（よく使う額に、登録の値と今の値（声で入れた額など）が無ければ足して小さい順に）。 */
const amountsWith = (registered: number | null, value: string): number[] => {
  const current = value.trim() === "" ? null : Number(value);
  const extras = [registered, current].filter(isExtra);
  return [...new Set([...PRESETS, ...extras])].sort((a, b) => a - b);
};

type BudgetChipsProps = {
  /** 今の値（空＝指定なし） */
  value: string;
  onChange: (value: string) => void;
  /** 登録の値（よく使う額に無ければ、そのチップを足す。選び直しても消さない） */
  registered?: number | null;
  failure: ApiFailure | null;
};

export const BudgetChips = ({ value, onChange, registered = null, failure }: BudgetChipsProps) => (
  <>
    <fieldset id="fetch-budget" className="budget-chips" data-testid="field-budgetMax" {...fieldAria("budgetMax", failure, "fetch-budget")}>
      <legend>1人あたりの予算の上限（この回だけ）</legend>
      <label className="budget-chip">
        <input type="radio" name="fetch-budget" data-testid="budget-none" checked={value.trim() === ""} onChange={() => onChange("")} />
        指定なし
      </label>
      {amountsWith(registered, value).map((amount) => (
        <label className="budget-chip" key={amount}>
          <input type="radio" name="fetch-budget" data-testid={`budget-${amount}`} checked={Number(value) === amount && value.trim() !== ""} onChange={() => onChange(String(amount))} />
          {yen(amount)}
        </label>
      ))}
    </fieldset>
    <FieldMessage inputId="fetch-budget" name="budgetMax" failure={failure} ctx={{ field: "予算の上限", min: BUDGET_MAX_MIN, max: BUDGET_MAX_MAX }} />
  </>
);
