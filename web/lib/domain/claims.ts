// 客に出る AI の文（店の選定の理由・人格つきの紹介文）に共通の、語と連絡先の決定論の検査。
// 副作用なし——選定の検査（domain/selection）と紹介文のガード（domain/pitch）が**同じこの1つ**を呼ぶ。
//
// 2026-09-25 監査の指摘 不具合-07 で切り出した。それまでは紹介文の層にだけあり、先に客へ出る選定の理由
// （紹介文が届くまでの待ちの表示・紹介文を諦めたときの確定の表示・普通の入口の結果）は素通しだった。
// 禁止語の一覧も、書き手への指示（adapters/orcarouter）と検査の正規表現の2か所で食い違っていて、
// 「最高の一杯」「人気店」「美味い」は指示では禁じているのに検査をすり抜けた。**一覧は下の1つの定数だけ**に置き、
// 指示に並べる文字列もここから作る（`unfoundedPraiseList`）。

/** 落ちた訳（機械が読む語）。呼ぶ側が自分の語（選定の rejection・紹介文の critique）に直す。 */
export type ClaimProblem = "contact" | "nonexistent_data" | "unfounded_praise";

/**
 * 食べたことがなければ言えない評価の断定（2026-09-22 本人の指摘で紹介文に入れた語・同 09-25 に選定の理由へ広げた）。
 *
 *   「AIの紹介文が**絶品だよなど根拠のない感想**を述べていて、**ステマ臭い**です」
 *
 * `word` は指示に並べる形、`stem` は活用しても当たるように縮めた照合の形（無ければ `word` のまま照らす）。
 * ⚠️ 入れるのは**誤って落とす余地がまず無い語だけ**。「近い」「好みに合いそう」「クーポンが使える」
 * のような**状況の言い換えは1語も入れない**——そこを混ぜると、通すべき文まで落ちる。
 * ⚠️ 広げすぎると書き直しと点数順への倒れが増える。語を足すときは実際に回して、倒れる率が上がらないことを確かめる。
 */
export const UNFOUNDED_PRAISE_TERMS: readonly { word: string; stem?: string }[] = [
  { word: "絶品" },
  { word: "極上" },
  { word: "最高" },
  { word: "名物" },
  { word: "自慢" },
  { word: "折り紙付き" },
  { word: "間違いない", stem: "間違いな" },
  { word: "外れない", stem: "外れな" },
  { word: "美味しい", stem: "美味し" },
  { word: "美味い" },
  { word: "おいしい", stem: "おいし" },
  { word: "うまい" },
  { word: "旨い" },
  { word: "絶妙" },
  { word: "本格的" },
  { word: "こだわりの" },
  { word: "評判" },
  { word: "人気" },
  { word: "逸品" },
];

const escapeForRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const UNFOUNDED_PRAISE = new RegExp(UNFOUNDED_PRAISE_TERMS.map((term) => escapeForRegExp(term.stem ?? term.word)).join("|"));

/** 書き手・選定への指示に並べる、使ってはいけない言い方の一覧（検査が落とす語と同じ定数から作る）。 */
export const unfoundedPraiseList = (): string => UNFOUNDED_PRAISE_TERMS.map((term) => term.word).join("・");

/**
 * 口コミ・レビューのデータはこのシステムに存在しない。**触れた時点で作り話**なので、AI に聞くまでもなく落とす。
 * 「星」は**数と組んだとき**だけにする（「星4つ」「★4.5」）——店名やメニュー名に「星」が入る店を、選定ごと
 * 点数順に倒さないため。
 */
const NONEXISTENT_DATA = /口コミ|クチコミ|レビュー|評価|星\s*[0-9一二三四五]|星の数|[★☆]/;

/** URL（scheme つき・www.・よくある末尾の住所）とメールの住所。全角は NFKC で半角へ寄せてから見る。 */
const URL_OR_MAIL = /https?:|www\.|[a-z0-9-]+\.(?:com|net|org|jp|io|co|shop|info|biz|me|app|tokyo)\b|[\w.+-]+@[\w-]+\.[\w.]+/i;

/**
 * 電話番号らしき並び。0 か +81 で始まり、数字と区切り（ハイフン・空白・括弧・長音）が続くもの。
 * 数字の途中の 0 からは始めない（「予算 10000 20000 円」のような金額の並びを電話番号と取り違えない）。
 */
const PHONE_CANDIDATE = /(?<!\d)(?:\+81|0)[\d\-‐−–—ー―\s()]{8,}/g;
/** 市外局番つきの固定電話が10桁・携帯が11桁（+81 を付けた形も国番号の2桁を足して10桁以上） */
const PHONE_MIN_DIGITS = 10;
/** 区切りつきの3つ組（0 で始まらない書き方も、前の検査が落としていたので落とし続ける） */
const HYPHENATED_TRIPLE = /\d{2,4}-\d{2,4}-\d{3,4}/;

const hasPhone = (text: string): boolean =>
  HYPHENATED_TRIPLE.test(text) || [...text.matchAll(PHONE_CANDIDATE)].some((match) => match[0].replace(/\D/g, "").length >= PHONE_MIN_DIGITS);

/**
 * 1本の文の、語と連絡先の問題を返す（無ければ null）。見る順は 連絡先 → 無いデータ → 根拠のない断定。
 * 全角の英数字・記号は NFKC で半角へ寄せてから見る（「０３－１２３４－５６７８」「ｗｗｗ．」をすり抜けさせない）。
 */
export const claimProblem = (text: string): ClaimProblem | null => {
  const normalized = text.normalize("NFKC");
  if (URL_OR_MAIL.test(normalized) || hasPhone(normalized)) return "contact";
  if (NONEXISTENT_DATA.test(normalized)) return "nonexistent_data";
  if (UNFOUNDED_PRAISE.test(normalized)) return "unfounded_praise";
  return null;
};
