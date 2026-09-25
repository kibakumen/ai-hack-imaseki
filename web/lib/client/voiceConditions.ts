// 声で入れた文から、人数・予算の上限・ジャンルを**決まった規則で**読み取る（2026-09-25 監査の指摘 客-16 の案A。
// 本人の第1回の指摘「歩きながら音声で入れたい。基本的にはポチポチ入力事項を埋めなくてもいい利便性向上のため」）。
//
// AI では読まない（案B は要件7の基準 7.12 の改訂が要る）。読み取りは端末の中で済ませ、サーバーへは送らない。
// 読めなかった項目は入れない（今の欄の値をそのまま残す）——決まった規則なので、聞き取れた分だけ埋まる。
// 範囲の外の値（11人・予算20万円）も読んだまま入れ、判定は入口の検査に任せる（画面は送る前に検査しない）。

import { TEXTS } from "../domain/texts";

/** 読み取れた条件。読めなかった項目は無い（undefined）。予算の `null` は「上限なし」と言われたとき。 */
export type SpokenConditions = { party?: number; budgetMax?: number | null; genres?: string[] };

const KANJI_DIGITS: Readonly<Record<string, number>> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

/** 「3」「三」「十」を数へ。読めなければ null。 */
const toCount = (word: string): number | null => {
  if (/^\d+$/.test(word)) return Number(word);
  return KANJI_DIGITS[word] ?? null;
};

const PARTY_PATTERN = /(\d+|[一二三四五六七八九十])\s*(?:人|名|にん|めい)/;
const PARTY_WORDS: ReadonlyArray<readonly [RegExp, number]> = [
  [/ひとり|一人|独り/, 1],
  [/ふたり|二人/, 2],
];

const readParty = (text: string): number | undefined => {
  const matched = PARTY_PATTERN.exec(text);
  if (matched) return toCount(matched[1]) ?? undefined;
  return PARTY_WORDS.find(([pattern]) => pattern.test(text))?.[1];
};

const NO_BUDGET = /予算(?:は)?(?:なし|無し|気にしない|いくらでも)/;
const THOUSAND_YEN = /(\d+|[一二三四五六七八九])\s*千\s*円/;
const YEN = /(\d[\d,]*)\s*円/;

const readBudget = (text: string): number | null | undefined => {
  if (NO_BUDGET.test(text)) return null;
  const thousands = THOUSAND_YEN.exec(text);
  if (thousands) {
    const count = toCount(thousands[1]);
    return count === null ? undefined : count * 1000;
  }
  const yen = YEN.exec(text);
  return yen ? Number(yen[1].replace(/,/g, "")) : undefined;
};

/**
 * ジャンルごとの言い方（選択肢は `domain/texts` の genres が正本。ここは聞き取るための言い換えだけ）。
 * 取り違えやすい語は外すか絞る: 「そば」だけだと「駅のそばで」（側）を拾うので「蕎麦」「おそば」「そば屋」に、
 * 「バー」だけだと「ハンバーグ」を拾うので、前が「ン」でないときだけにする。
 */
export const GENRE_KEYWORDS: Readonly<Record<string, readonly RegExp[]>> = {
  和食: [/和食/, /日本料理/],
  "寿司・海鮮": [/寿司/, /すし/, /鮨/, /海鮮/, /刺身/],
  焼肉: [/焼肉/, /焼き肉/, /やきにく/],
  "焼き鳥・串": [/焼き鳥/, /焼鳥/, /やきとり/, /串焼き/, /串カツ/, /串揚げ/],
  居酒屋: [/居酒屋/, /飲み屋/],
  ラーメン: [/ラーメン/, /らーめん/],
  "そば・うどん": [/蕎麦/, /おそば/, /そば屋/, /ざるそば/, /うどん/],
  中華: [/中華/, /餃子/],
  "イタリアン・洋食": [/イタリアン/, /洋食/, /パスタ/, /ピザ/],
  "カレー・エスニック": [/カレー/, /エスニック/, /タイ料理/],
  韓国料理: [/韓国/],
  "カフェ・バー": [/カフェ/, /喫茶/, /(?<!ン)バー/],
};

const readGenres = (text: string): string[] => TEXTS.genres.filter((genre) => (GENRE_KEYWORDS[genre] ?? []).some((pattern) => pattern.test(text)));

/** 声で入れた文を読む。全角の数字や記号は半角へ揃えてから読む。 */
export const parseSpokenConditions = (spoken: string): SpokenConditions => {
  const text = spoken.normalize("NFKC");
  const party = readParty(text);
  const budgetMax = readBudget(text);
  const genres = readGenres(text);
  return {
    ...(party === undefined ? {} : { party }),
    ...(budgetMax === undefined ? {} : { budgetMax }),
    genres,
  };
};
