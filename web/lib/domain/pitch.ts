// 人格つきの紹介文の決定論のガード（速成版 `sprint/lib/personaPitch.ts` の検査の部分を写したもの）。
// 副作用なし——AI を呼ぶのは lib/usecases/writePitch（差し替え口 PitchWriter）で、ここは返ってきた
// 文字列を見るだけ。設計書「どの判断をどこに置くか」の並びに合わせて lib/domain に置く。
//
// 三段構えの真ん中: ①書き手（AI）→ **②このガード（決定論）** → ③検査官（別ベンダーの AI）。
// 決定論で落とせるものを AI に聞かない（速い・ただ・揺れない）。

import { stripCodeFence } from "./selection";

/** 紹介文の字数の上限（値は AI判断。速成版と同じ 120 字） */
export const PITCH_CHAR_LIMIT = 120;

/**
 * 口コミ・レビューのデータはこのシステムに存在しない。**触れた時点で作り話**なので、
 * AI に聞くまでもなく落とす（ハルシネーション対策の核）。
 */
const FORBIDDEN_WORDS = /(口コミ|クチコミ|レビュー|評価|星)/;
const URL_OR_PHONE = /https?:|\d{2,4}-\d{2,4}-\d{3,4}/;

/**
 * 食べたことがなければ言えない評価の断定（2026-09-22 本人の指摘で追加）。
 *
 *   「AIの紹介文が**絶品だよなど根拠のない感想**を述べていて、**ステマ臭い**です」
 *
 * 書き手はその店で食べていないので、味や品質を断定した時点で**根拠が無い**。
 * 検査官（AI）にも同じ規則を入れたが、**決定論で落とせるものを AI に聞かない**のがこの層の役目
 * （速い・ただ・揺れない）。
 *
 * ⚠️ 入れるのは**誤って落とす余地がまず無い語だけ**。「近い」「好みに合いそう」「クーポンが使える」
 * のような**状況の言い換えは1語も入れない**——そこを混ぜると、通すべき文まで落ちる。
 * ⚠️ 広げすぎると書き直しが増え、2回で決定論の文へ倒れる（`writePitch` の `MAX_ATTEMPTS`）。
 * 語を足すときは実際に回して、倒れる率が上がらないことを確かめること。
 */
const UNFOUNDED_PRAISE = /(絶品|極上|最高級|名物|自慢|折り紙付き|間違いな|外れな|美味し|おいし|うまい|絶妙|本格的|こだわりの|評判|大人気|逸品)/;

/** 文全体を囲っている引用符だけを外す（対になっていないものは触らない）。 */
const QUOTE_PAIRS: readonly (readonly [string, string])[] = [
  ['"', '"'],
  ["'", "'"],
  ["`", "`"],
  ["「", "」"],
  ["『", "』"],
];

/**
 * 文を丸ごと囲っている引用符を1組だけ外す。
 * ⚠️ 中にもう1つ閉じ括弧が在るなら「囲い」ではない（例: 「刺身」と「焼き魚」）——片側だけ削ると
 * 文が壊れる（速成版で1度そうなった・2026-09-21）。
 */
const unwrapQuotes = (text: string): string => {
  for (const [open, close] of QUOTE_PAIRS) {
    if (text.length > open.length + close.length && text.startsWith(open) && text.endsWith(close)) {
      const inner = text.slice(open.length, text.length - close.length);
      if (!inner.includes(close)) return inner.trim();
    }
  }
  return text;
};

export type PitchCheck = { ok: true; text: string } | { ok: false; critique: string };

/**
 * 紹介文1本の検査。落ちた訳（critique）は**書き直しの指示として AI へ返す**ので、
 * 機械の語ではなく短い日本語で書く。
 */
export const checkPitch = (raw: string): PitchCheck => {
  const text = unwrapQuotes(raw.trim());
  if (text.length === 0) return { ok: false, critique: "空文だった" };
  if ([...text].length > PITCH_CHAR_LIMIT) return { ok: false, critique: `${PITCH_CHAR_LIMIT}字を超えていた` };
  if (URL_OR_PHONE.test(text)) return { ok: false, critique: "URLか電話番号らしき文字列が入っていた" };
  if (FORBIDDEN_WORDS.test(text)) return { ok: false, critique: "口コミ・レビュー・評価など存在しないデータに触れていた" };
  // 落ちた訳は**書き直しの指示として AI へ返る**ので、何を書き直せばよいかまで言う。
  if (UNFOUNDED_PRAISE.test(text)) return { ok: false, critique: "食べたことがないと言えない評価を断定していた。近さ・すすめているメニュー・好みとの重なり・使えるクーポンだけで書き直す" };
  return { ok: true, text };
};

/** 検査官の答えの上限（長い作文を critique に持ち込まない） */
const CRITIQUE_MAX_LENGTH = 80;

export type Judgement = { ok: boolean; critique: string | null };

/**
 * 検査官（別ベンダーの AI）の答え `{"ok":true|false,"reason":"…"}` を読む。
 * 読めなければ null——**読めなかったことを「合格」に倒さない**（守りが黙って外れないようにする）。
 */
export const readJudgement = (text: string): Judgement | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    return null;
  }
  const entry = parsed as { ok?: unknown; reason?: unknown } | null;
  if (typeof entry?.ok !== "boolean") return null;
  const reason = typeof entry.reason === "string" ? entry.reason.trim().slice(0, CRITIQUE_MAX_LENGTH) : "";
  return { ok: entry.ok, critique: entry.ok || reason.length === 0 ? null : reason };
};

/** 紹介文の元になる店の姿（lib/ports の PitchStore と同じ形。domain は外の型を読まないので写す）。 */
export type PitchStoreFacts = { name: string; genres: string[]; menus: string[]; couponName: string | null; couponNote: string | null };

/** どの店にも当てはまる最後の1文（クーポンもメニューも無い店のため） */
const LAST_RESORT = "近くの気になる一軒です";

/**
 * 人格つきの文を諦めるときの、決定論の文（AI を新たに呼ばない）。
 * 選定が既に返している理由をそのまま使い、それも無ければクーポン → メニューの順に倒す。
 */
export const fallbackPitch = (store: PitchStoreFacts, selectionReason: string): string => {
  if (selectionReason.trim().length > 0) return selectionReason;
  if (store.couponName) return `${store.couponName}が使えます`;
  const menu = store.menus[0];
  return menu ? `おすすめは${menu}` : LAST_RESORT;
};
