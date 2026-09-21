// 形と範囲の数字のただ1つの置き場（設計書「どの判断をどこに置くか」）。数字の定数だけを持ち、
// 何も import しない（domain/texts.ts と同じ性質）。全部の入口と、部品の入力欄の属性がここを読む。
// 各タスクが自分の要件の数字をここへ足す（要件ごとに割り当てられた基準が持つ・要件29の補足）。

// 要件1（客の登録）の基準1.2・1.3・1.4・1.7
export const NICKNAME_MIN = 1;
export const NICKNAME_MAX = 20;
export const PHONE_PATTERN = /^0\d{9,10}$/;
export const CUSTOMER_GENRES_MAX = 12;
export const BUDGET_MAX_MIN = 0;
export const BUDGET_MAX_MAX = 100_000;

// 要件2（客の識別子）の基準2.2
export const TOKEN_BYTES = 16;
