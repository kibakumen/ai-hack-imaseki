// 決まった文のただ1つの置き場（設計書「どの判断をどこに置くか」）。
// 何も import しない（schemas/limits.ts と同じ性質。「依存の向き」の注——
// 部品・画面・lib/client が lib/domain から値として読めるのはこのファイルだけ）。
// 利用者を責める語（「不正」「誤り」「無効」）は使わない。

type Ctx = Record<string, unknown>;
const str = (v: unknown, fallback = ""): string => (v === undefined || v === null ? fallback : String(v));

// ---------- 入力の断り（kind） ----------
const INPUT_REFUSAL_TEXTS: Record<string, (ctx: Ctx) => string> = {
  invalid_input: () => "入れた内容を確かめてください。",
  party_over_max: () => "この店では受け入れられません。確保を取り消して探し直せます。",
  email_taken: () => "このメールアドレスは登録済みです。",
  limit_reached: () => "これ以上は追加できません（上限に達しています）。",
  coupon_in_use: () => "公開中のオファーが見せているクーポンは変えられません。",
  address_unresolved: () => "住所が場所に直せませんでした。入れ直すか、しばらくしてやり直してください。",
  profile_incomplete: () => "店名・住所・ジャンル・予算の幅を先に入れてください。",
  offer_exists: () => "今のオファーが終わってから公開できます。",
  offer_ended: () => "このオファーは終わっています。",
  until_in_past: (ctx) => `${str(ctx.input, "その時刻")}は今より前の時刻です。今すぐ終わらせるには「公開を止める」を押してください。`,
  until_over_window: (ctx) => `枠の外です（最長 ${str(ctx.latest ?? ctx.max)} まで）。それより先まで出すには、公開を止めて新しく公開し直してください。`,
  approval_missing: () => "営業許可書とカードの登録が揃うと承認できます。",
  file_unsupported: () => "PDF・JPEG・PNG のファイルを選んでください。",
  file_too_large: () => "PDF・JPEG・PNG のファイルを10MBまでで選んでください。",
  card_setup_failed: () => "カードの登録ができませんでした。やり直してください。",
  // ⚠️ 「メールアドレスが違」「パスワードが違」を含めない（受け入れ検査 r14 の画面の検査が、
  // どちらが違うかを言っていないことを、この語が無いことで見る）。設計書 443行の文案
  // 「メールアドレスかパスワードが違います」は、その語をそのまま含むので言い換えた（2026-09-21）。
  login_failed: () => "メールアドレスかパスワードが合いません。",
  place_unresolved: () => "場所が分かりませんでした。入れ直すか、現在地を使ってください。",
  report_not_allowed: () => "この店には通報できません。",
  human_check_failed: () => "人による操作かを確かめられませんでした。ページを読み込み直して、もう一度お試しください。",
  rate_limited: () => "しばらく待ってからお試しください。",
  location_required: () => "場所を文字で入れてください。",
  network: () => "通信に失敗しました。もう一度お試しください。",
};

// ---------- 項目ごとの理由（reason） ----------
const FIELD_REASON_TEXTS: Record<string, (ctx: Ctx) => string> = {
  required: (ctx) => `${str(ctx.field, "この項目")}を入れてください。`,
  // ⚠️ 短い側と長い側で**違う文**にする（受け入れ検査 r14 の 14.15 が、同じ欄に続けて出た2つの文が
  // 入れ替わったことを、文の違いで見る）。範囲そのものは両方に出す——直すには上下の両方が要るため。
  too_short: (ctx) => `${str(ctx.field, "この項目")}は${str(ctx.min, "")}〜${str(ctx.max, "")}字で入れてください（今は短いようです）。`,
  too_long: (ctx) => `${str(ctx.field, "この項目")}は${str(ctx.min, "")}〜${str(ctx.max, "")}字で入れてください（今は長いようです）。`,
  out_of_range: (ctx) => `${str(ctx.field, "この項目")}は${str(ctx.min, "")}〜${str(ctx.max, "")}の数で入れてください。`,
  not_integer: (ctx) => `${str(ctx.field, "この項目")}は整数で入れてください。`,
  bad_format: (ctx) => `${str(ctx.field, "この項目")}は${str(ctx.hint, "決まった形式")}で入れてください。`,
  not_allowed: (ctx) => `${str(ctx.field, "この項目")}は選択肢から選んでください。`,
  too_many: (ctx) => `${str(ctx.field, "この項目")}は${str(ctx.max, "")}件までです。`,
  min_over_max: (ctx) => `${str(ctx.field, "この項目")}の最低は最高以下にしてください。`,
  over_capacity: (ctx) => `足したあとの残りは${str(ctx.max, "")}までです（今の残り${str(ctx.remaining ?? ctx.min, "")}）。`,
  over_remaining: (ctx) => `減らせるのは残りの${str(ctx.remaining ?? ctx.max, "")}までです。`,
  in_past: () => "今より後の時刻にしてください。",
  // ⚠️ 設計書 447行の文案は「今から12時間以内の時刻にしてください」だったが、受け入れ検査
  // r17-publish.ui.test.tsx が「公開を止め」か「新しく公開」を含むことを見るので、次の手を足した
  // （要件19の基準 19.13 の文と同じ言い方に揃えた・2026-09-21）。
  over_window: () => "公開から12時間以内の時刻にしてください。それより先まで出すときは、公開を止めて新しく公開し直してください。",
};

// ---------- 受け取りの断り（domain/receiveRefusal.ts の閉じた5種） ----------
const RECEIVE_REFUSAL_TEXTS: Record<string, (ctx: Ctx) => string> = {
  sold_out: () => "この店は今、満席になりました。",
  offer_ended: () => "この店の受け付けは終わりました。",
  party_over_max: (ctx) => `この店は今、${str(ctx.partyMax, "")}名までになりました。`,
  has_active_reservation: () => "今の確保があります。",
  store_banned: () => "このお店は運営により停止されました。",
};

// ---------- 次の一手（domain/receiveRefusal.nextStep の閉じた4種） ----------
const NEXT_STEP_TEXTS: Record<string, (ctx: Ctx) => string> = {
  search_again: () => "探し直す",
  search_again_with_party: (ctx) => `${str(ctx.partyMax, "")}名で探し直す`,
  back_to_reservation: () => "確保中の表示へ戻る",
  retry_same_party: () => "同じ人数で受け取り直す",
};

// ---------- プッシュ（場面ごとの決まった文。中身を載せないプッシュの文面） ----------
const PUSH_TEXTS: Record<string, () => { title: string; body: string }> = {
  store_cancelled: () => ({ title: "確保が取り消されました", body: "お店の都合で確保が取り消されました。アプリを開いて確かめてください。" }),
  admin_cancelled: () => ({ title: "確保が取り消されました", body: "運営の都合で確保が取り消されました。アプリを開いて確かめてください。" }),
};

// ---------- ジャンルの選択肢の表示（チェックの並び） ----------
// 判断の正本は domain/genres.ts の GENRES。部品・画面は lib/domain のうち texts.ts しか値として
// 読めない（依存の向き）ので、画面に出す並びをここに置く。2つがずれないことは
// domain/genres.test.ts が縛る（写しを置くときは、一致を検査で固定する）。
const GENRE_OPTIONS = ["和食", "寿司・海鮮", "焼肉", "焼き鳥・串", "居酒屋", "ラーメン", "そば・うどん", "中華", "イタリアン・洋食", "カレー・エスニック", "韓国料理", "カフェ・バー"] as const;

export const TEXTS = {
  genres: GENRE_OPTIONS,
  inputRefusal: (kind: string, ctx: Ctx = {}): string => (INPUT_REFUSAL_TEXTS[kind] ?? (() => "入れた内容を確かめてください。"))(ctx),
  fieldReason: (reason: string, ctx: Ctx = {}): string => (FIELD_REASON_TEXTS[reason] ?? (() => "入れ直してください。"))(ctx),
  receiveRefusal: (kind: string, ctx: Ctx = {}): string => (RECEIVE_REFUSAL_TEXTS[kind] ?? (() => "受け取れませんでした。"))(ctx),
  nextStep: (step: string, ctx: Ctx = {}): string => (NEXT_STEP_TEXTS[step] ?? (() => "探し直す"))(ctx),
  push: (scene: string): { title: string; body: string } => (PUSH_TEXTS[scene] ?? (() => ({ title: "お知らせ", body: "アプリを開いて確かめてください。" })))(),
  fallbackReason: "今の条件で近い順に選びました",
} as const;

// ---------- クーポンの画面の断りの文（要件16の基準 16.2・16.5） ----------
// 汎用の INPUT_REFUSAL_TEXTS では足りない語が2つある:
//   limit_reached … 汎用の文は個数を言わない（上の語は 15.7 のおすすめメニューとも共有なので、
//                   そちらの個数に寄せられない）。クーポンの画面は「3つまで」と数を出す。
//   coupon_in_use … 汎用の文は「変えられません」で止まり、次の一手（公開を止める）を言わない。
//                   基準 16.5 は「公開を止めてから行うよう示す」ことまでを求める。
// 語から文を選ぶ判断は、決まった文の置き場であるこのファイルに置く（部品の側で語を場合分けしない）。

/** 断りの応答のうち、文を選ぶのに要る所だけ（lib/domain は何も import しないので、形だけで受ける）。 */
type CouponFailure = { error?: { kind?: string; fields?: Array<{ name: string }> } } | null | undefined;

const COUPON_FORM_TEXTS: Record<string, (max: number) => string> = {
  limit_reached: (max) => `クーポンは${max}つまでです。`,
  coupon_in_use: () => "公開中のオファーが見せているクーポンは、公開を止めてから変えられます。",
};

export const COUPON_TEXTS = {
  /**
   * 押した操作の直下に出す文。項目に帰せる断り（name・note）のときは null——その文は
   * 項目の直下（msg-<項目名>）に出るので、ここでは出さない。
   */
  formMessage: (failure: CouponFailure, max: number): string | null => {
    const error = failure?.error;
    if (!error?.kind) return null;
    if ((error.fields ?? []).length > 0) return null;
    return (COUPON_FORM_TEXTS[error.kind] ?? ((): string => TEXTS.inputRefusal(error.kind ?? "")))(max);
  },
} as const;
