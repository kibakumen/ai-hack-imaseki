// 断りの語 → 状態コードの対応のただ1つの置き場（2026-09-25 監査の指摘 設計-13・横断-01）。
//
// それまで手続きの半分（8本）が HTTP の状態コードを自分で持ち、残りは入口が手で書いていた。
// 同じ語が操作によって違う状態コードになりうる形で、次に変えるときに片方だけ直る温床だった。
// 手続きは**断りの種類だけ**を返し、状態コードへの対応はこの表1つで持つ。
//
// 応答の形は3通り（設計書「入力の断りの応答の形」）:
//   入力の断り           … `{ ok:false, error:{ kind, fields?, … } }`（このファイルの `refusal`）
//   今の状態による断り   … 409 `{ ok:false, current:{ state } }`（`stateConflict`）
//   受け取りの断り       … 409 `{ ok:false, refusal, home }`（endpoints/reservations が組む）

import type { FieldReason, ServerRefusalKind } from "../domain/inputRefusal";
import { RECEIVE_REFUSAL, type ReceiveRefusalDto } from "../schemas/responses";
import type { RouteHandlerResult } from "./defineRoute";
import { ResponseShapeError } from "./respond";

const STATUS_BY_KIND: Record<ServerRefusalKind, number> = {
  // 形・範囲の誤り（入れ直せば通る）
  invalid_input: 400,
  file_unsupported: 400,
  file_too_large: 400,
  place_unresolved: 400,
  human_check_failed: 400,
  // 見分け
  login_failed: 401,
  unauthenticated: 401,
  forbidden: 403,
  // 確かめのために入れさせた今のパスワードが合わない（もう入っている本人。見分けの 401 とは分ける）
  password_mismatch: 403,
  not_found: 404,
  // 今の状態との衝突（入力の形は合っている）
  party_over_max: 409,
  email_taken: 409,
  limit_reached: 409,
  coupon_in_use: 409,
  address_unresolved: 409,
  profile_incomplete: 409,
  offer_exists: 409,
  offer_ended: 409,
  until_in_past: 409,
  until_over_window: 409,
  approval_missing: 409,
  card_setup_failed: 409,
  report_not_allowed: 409,
  has_active_reservation: 409,
  store_banned: 409,
  // 本文が大きすぎる（読み切る前に断る・安全-13）
  body_too_large: 413,
  rate_limited: 429,
  internal: 500,
};

/** 断りの語の状態コード。 */
export const statusOfRefusal = (kind: ServerRefusalKind): number => STATUS_BY_KIND[kind];

/** 断りに添える中身（どの項目か・場面ごとの値）。 */
export type RefusalDetail = { fields?: ReadonlyArray<{ name: string; reason: FieldReason }>; [extra: string]: unknown };

/** 入力の断りの応答。状態コードは語から決まる（入口ごとに書かない）。 */
export const refusal = (kind: ServerRefusalKind, detail: RefusalDetail = {}, cookies?: string[]): RouteHandlerResult => ({
  status: statusOfRefusal(kind),
  body: { ok: false, error: { kind, ...detail } },
  ...(cookies ? { cookies } : {}),
});

/**
 * 見つからない（404）。経路が無い・番号が無い・別の店や別の客のもの、を区別して見せない
 * ——在る無しを教えないため（基準 16.4・20.x・21.x）。全部の入口がこの1つを使う。
 */
export const notFound = (): RouteHandlerResult => refusal("not_found");

/** ログインしていない・切れた・Cookie の客が見つからない（401）。 */
export const unauthenticated = (): RouteHandlerResult => refusal("unauthenticated");

/** 役割が違う・書き込みの Origin が合わない（403）。 */
export const forbidden = (): RouteHandlerResult => refusal("forbidden");

/**
 * 今の状態による断り（409）。確保への操作・承認／停止／戻すが、今の状態を返して断る。
 * `extra` は今の状態に添える印（運営の承認と確かめが、見たあとで店の内容が変わったことを `changed: true` で添える・運営-02）。
 */
export const stateConflict = (state: string, extra: Record<string, boolean> = {}): RouteHandlerResult => ({ status: 409, body: { ok: false, current: { state, ...extra } } });

/**
 * 受け取りの断り（409）。理由・次の一手・新しいホームを1つの応答で返す（描くのは RefusalNotice）。
 * 返す前に形（schemas/responses の RECEIVE_REFUSAL）を確かめ、崩れていれば投げる（defineRoute が 500・internal と
 * `response_shape_error` の記録にする）——成功の応答の respond と同じ道（2026-09-26 のレビュー・設計-07 の残り）。
 */
export const receiveRefused = (refusalBody: ReceiveRefusalDto["refusal"], home: ReceiveRefusalDto["home"]): RouteHandlerResult => {
  const body: ReceiveRefusalDto = { ok: false, refusal: refusalBody, home };
  if (!RECEIVE_REFUSAL.safeParse(body).success) throw new ResponseShapeError("POST /api/customer/reservations");
  return { status: 409, body };
};
