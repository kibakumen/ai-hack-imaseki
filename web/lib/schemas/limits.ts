// 形と範囲の数字のただ1つの置き場（設計書「どの判断をどこに置くか」）。数字の定数だけを持ち、
// 何も import しない（domain/texts.ts と同じ性質）。全部の入口と、部品の入力欄の属性がここを読む。
// 各タスクが自分の要件の数字をここへ足す（要件ごとに割り当てられた基準が持つ・要件29の補足）。

// 要件1（客の登録）の基準1.2・1.3・1.4・1.7
export const NICKNAME_MIN = 1;
export const NICKNAME_MAX = 20;
export const PHONE_PATTERN = /^0\d{9,10}$/;
/** 入力欄の補助の属性に使う桁数（正本は上の形。基準 1.3） */
export const PHONE_MAX_LENGTH = 11;
export const CUSTOMER_GENRES_MAX = 12;
export const BUDGET_MAX_MIN = 0;
export const BUDGET_MAX_MAX = 100_000;

// 要件2（客の識別子）の基準2.2
export const TOKEN_BYTES = 16;

// 内部の番号（customers.id など。Cookie の値とは別物・設計書「客の識別子」）の乱数の長さ（AI判断）
export const ID_BYTES = 16;

// 要件12（店の登録）の基準 12.3・12.4・12.5
export const STORE_NAME_MIN = 1;
/** 店名の上限は要件15の基準 15.2 と同じ範囲（基準 12.5 がそれを指す） */
export const STORE_NAME_MAX = 50;
export const EMAIL_MAX = 254;
/** @ をちょうど1つ含み、その前後に1字以上ある（基準 12.4。空白は認めない） */
export const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

// 要件14（ログインとセッション）
/** パスワードの塩の長さ（AI判断） */
export const PASSWORD_SALT_BYTES = 16;
/** PBKDF2-SHA256 の繰り返しの回数（Workers の上限は100,000・設計書「比べた案」）。値は password_hash に一緒に保存する */
export const PASSWORD_ITERATIONS = 100_000;
/** セッションの Cookie に載せる乱数の長さ */
export const SESSION_TOKEN_BYTES = 16;
/**
 * セッションの寿命は2時間で、アクセスのたびに残りが半分（1時間）を切っていたら延ばす
 * （スライディングウィンドウ・本人選択／AI提示 2026-09-21。旧: 14日）。
 * ⚠️ この2つの数字を変えると、偽の時計を大きく進める受け入れ検査の見え方が変わる（実行者の報告を参照）。
 */
export const SESSION_MAX_AGE_SECONDS = 25 * 60 * 60;
export const SESSION_RENEW_WITHIN_SECONDS = 60 * 60;

// 要件17（オファーの公開）の基準 17.3・17.4・17.5／要件19（公開中の変更）の基準 19.1・19.2・19.6
/** 募集する組数（基準 17.3・範囲は AI判断） */
export const OFFER_CAPACITY_MIN = 1;
export const OFFER_CAPACITY_MAX = 20;
/** 何名まで（基準 17.4・範囲は AI判断） */
export const OFFER_PARTY_MAX_MIN = 1;
export const OFFER_PARTY_MAX_MAX = 10;
/** 「何名まで」の用意した選択肢（基準 17.4・AI判断） */
export const OFFER_PARTY_MAX_CHOICES = [2, 4, 6] as const;
/** 見せるクーポンは店が持てるクーポンの数まで（要件16の基準 16.2） */
export const OFFER_COUPONS_MAX = 3;
/** 「何時まで」の入力の形（時分だけ。解釈の正本は domain/until.ts） */
export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
