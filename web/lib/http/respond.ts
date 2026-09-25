// 入口が成功を返すただ1つの道（2026-09-25 監査の指摘 設計-07）。
//
// 本文は応答の形の表（schemas/responses の RESPONSES）の型で型検査され、返す前にも同じ形で確かめる。
// 画面（client/api の callApi）も同じ表で確かめるので、サーバーと画面が1つの定義でつながる——
// 項目の名前を変えたのに片方だけ直った、が型検査で捕まり、型をすり抜けた崩れも検査が 500 で拾う。
//
// 形が崩れていたら投げる（defineRoute が受け止め、500・internal と `response_shape_error` の記録にする）。
// 崩れた本文をそのまま画面へ渡すと、画面は undefined を描くか落ちる。

import { RESPONSES, type ResponseOf, type RouteKey } from "../schemas/responses";
import type { RouteHandlerResult } from "./defineRoute";

/** 入口が組んだ成功の本文が、応答の形の表と合わない。文には入口の鍵だけを持つ（記録には種類しか出ない）。 */
export class ResponseShapeError extends Error {
  constructor(readonly route: RouteKey) {
    super(`応答の形が表と合いません: ${route}`);
    this.name = "ResponseShapeError";
  }
}

/** 成功の応答。`route` は入口の鍵（その入口の method と path）。 */
export const respond = <K extends RouteKey>(route: K, body: ResponseOf<K>, status = 200, cookies?: string[]): RouteHandlerResult => {
  if (!RESPONSES[route].safeParse(body).success) throw new ResponseShapeError(route);
  return { status, body, ...(cookies ? { cookies } : {}) };
};
