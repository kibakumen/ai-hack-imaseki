// AI の出力の検査と、点数順への倒し方（要件7の基準 7.3・7.4・7.5・7.7・7.8）。
// 副作用なし——AI を呼ぶのは lib/usecases/fetchOffers（差し替え口 AiSelector）で、ここは返ってきた
// 文字列を見るだけ。設計書「どの判断をどこに置くか」の `domain/selection.ts` の行。

import { TEXTS } from "./texts";

/** AI が選べる件数の上限（基準 7.3） */
export const SELECTION_MAX = 5;
/** 理由の文の上限（基準 7.4・値は AI判断） */
export const REASON_MAX_LENGTH = 60;
/** 点数順に倒したときに返す件数（基準 7.6・7.7） */
export const FALLBACK_MAX = 5;

export type Selection = { storeId: string; reason: string };

/**
 * 検査に落ちた訳（機械が読む語）。記録の `ai_calls.validation_failed` に添えるためのもので、
 * 客には見せない（倒れたときの文は基準 7.8 の決まった文ひとつ）。
 */
export type SelectionRejection =
  | "not_json"
  | "bad_shape"
  | "unknown_store"
  | "too_many"
  | "duplicate_store"
  | "empty_reason"
  | "reason_too_long"
  | "reason_multi_sentence"
  | "reason_has_newline";

export type SelectionResult = { ok: true; items: Selection[] } | { ok: false; rejection: SelectionRejection };

/**
 * 文の終わりの印。ASCII の「.」は入れない（AI判断）——「1,000円台.」より
 * 「予算3.000円」のような小数や URL を巻き込む方が起こりやすく、正しい文を落としてしまう。
 */
const SENTENCE_END = /[。！？!?]/;
const TRAILING_SENTENCE_END = /[。！？!?]$/;

/**
 * ```json … ``` で包まれていたら中身を取り出す（基準 7.3 の「コードフェンスつきでも受ける」）。
 * 紹介文の検査官の答えも同じ癖で返ってくるので domain/pitch も読む（判定の写しを作らない）。
 */
export const stripCodeFence = (text: string): string => {
  const fenced = text.trim().match(/^```[A-Za-z0-9_-]*\s*\n?([\s\S]*?)\n?```$/);
  return (fenced ? fenced[1] : text).trim();
};

/** 理由1文の検査（基準 7.3 の「空」と基準 7.4 の「1文・60字以内・改行なし」）。通れば null */
const reasonRejection = (reason: unknown): SelectionRejection | null => {
  if (typeof reason !== "string") return "empty_reason";
  if (/[\r\n]/.test(reason)) return "reason_has_newline";
  const trimmed = reason.trim();
  if (trimmed.length === 0) return "empty_reason";
  if ([...trimmed].length > REASON_MAX_LENGTH) return "reason_too_long";
  // 1文＝終わりの印が末尾にしか無い。末尾の1つを外しても残っていれば2文以上。
  if (SENTENCE_END.test(trimmed.replace(TRAILING_SENTENCE_END, ""))) return "reason_multi_sentence";
  return null;
};

/** 1件ぶんの検査。通れば整えた値、落ちれば訳を返す */
const selectionOf = (raw: unknown, allowed: ReadonlySet<string>, seen: ReadonlySet<string>): Selection | SelectionRejection => {
  const entry = raw as { storeId?: unknown; reason?: unknown } | null;
  const storeId = entry?.storeId;
  if (typeof storeId !== "string" || storeId.length === 0) return "bad_shape";
  if (!allowed.has(storeId)) return "unknown_store"; // 基準 7.3（渡していない店）
  if (seen.has(storeId)) return "duplicate_store"; // 基準 7.3（同じ店が2回）
  const rejection = reasonRejection(entry?.reason);
  if (rejection) return rejection;
  return { storeId, reason: String(entry?.reason).trim() };
};

/**
 * AI の出力の本文 `{"selections":[{"storeId","reason"}]}` を検査する（基準 7.3・7.4）。
 * 0件の選定はそのまま0件として通す（基準 7.5——AI の「合う店が無い」を握り潰さない）。
 *
 * @param text AI が返した本文（コードフェンスつきでも受ける）
 * @param allowedIds 渡した店の番号（点数順の上位10件）
 */
export const validateSelection = (text: string, allowedIds: readonly string[]): SelectionResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    return { ok: false, rejection: "not_json" };
  }
  const selections = (parsed as { selections?: unknown } | null)?.selections;
  if (!Array.isArray(selections)) return { ok: false, rejection: "bad_shape" };
  if (selections.length > SELECTION_MAX) return { ok: false, rejection: "too_many" }; // 基準 7.3（6件）

  const allowed = new Set(allowedIds);
  const seen = new Set<string>();
  const items: Selection[] = [];
  for (const raw of selections) {
    const result = selectionOf(raw, allowed, seen);
    if (typeof result === "string") return { ok: false, rejection: result };
    seen.add(result.storeId);
    items.push(result);
  }
  return { ok: true, items };
};

/**
 * 点数順への倒し方（基準 7.6・7.7）。点数順の上位5件（あるだけ）に、決まった文（基準 7.8）を入れる。
 *
 * @param rankedIds 点数順（domain/score の rankStores の並び）の店の番号
 */
export const fallbackResult = (rankedIds: readonly string[]): Selection[] =>
  rankedIds.slice(0, FALLBACK_MAX).map((storeId) => ({ storeId, reason: TEXTS.fallbackReason }));
