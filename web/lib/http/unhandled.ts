// 想定外の例外を受け止める（2026-09-25 監査の指摘 設計-15）。
//
// 受け止める場所は2つだけ——入口（defineRoute の手続きの全体）と、橋（app の serveSafely・
// Deps を組む所の落ちも受ける）。ここは「記録に何を出すか」と「応答の形」だけを持つ。
//
// ⚠️ 記録には**例外の種類だけ**を出す。例外の文には客の入力や SQL の値が混ざりうる
// （D1 の UNIQUE の落ちは列の名前を、手続きの例外は入力の値を含むことがある）ので、文は出さない。
// Logger の項目は `event`・`id`・`errorKind` の決まった語だけ（設計書「ログに何を書くか」）。

import type { Logger } from "../ports";
import { refusal } from "./refusals";
import type { RouteHandlerResult } from "./defineRoute";

/** 記録に出してよい形の語へ（小文字・数字・`_`・`.`・`-` だけ）。 */
const toLogWord = (name: string): string =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "_")
    .slice(0, 40) || "unknown";

/**
 * 例外の種類。D1 の落ちは `d1_error`、それ以外は例外の名前（`TypeError` → `type_error`）。
 * 文（message）は見分けにだけ使い、記録には出さない。
 */
export const errorKindOf = (error: unknown): string => {
  if (!(error instanceof Error)) return toLogWord(typeof error);
  const cause = error.cause instanceof Error ? error.cause.message : "";
  if (/^D1_|SQLITE_/.test(error.message) || /SQLITE_/.test(cause)) return "d1_error";
  return toLogWord(error.name);
};

/** 受け止めた例外を記録し、`500 { ok:false, error:{ kind:"internal" } }` を返す。 */
export const internalError = (logger: Logger | undefined, id: string, error: unknown): RouteHandlerResult => {
  try {
    logger?.log({ event: "unhandled_error", id, errorKind: errorKindOf(error) });
  } catch {
    // 記録の出口そのものが落ちても、応答は返す（ここで投げると Next の既定の 500 に戻る）
  }
  return refusal("internal");
};
