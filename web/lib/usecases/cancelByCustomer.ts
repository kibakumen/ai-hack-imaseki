// 客による確保の取り消し（要件10の基準 10.1・10.2・10.3・要件18の基準 18.2・要件27の基準 27.4）。
//
// 順は4つ:
//   1. その客の確保を読む（在らない番号・別の客の確保は入力の断りへ倒す＝存在を教えない）
//   2. 取り消せる状態か判断する（`domain/reservation.canCancelByCustomer`）
//   3. **前の状態を WHERE に入れた1つの UPDATE**（読んだあとに状態が動いても上書きしない）と、状態の変化の
//      記録（基準 27.4）を1つのまとまりで書く（不具合-16）
//   4. 新しいホームを返す（取り消したあとは取得の画面・基準 9.5）
//
// 残りはどこにも保存していない（募集する組数と確保の行から導く）ので、基準 18.2 の「1戻る」は
// 状態が `customer_cancelled` になった時点でそのまま満たされる（`repo/sqlFragments` の
// `holdsSlotCondition` が客の取り消しを数えない）。

import { canCancelByCustomer, effectiveState, type EffectiveState } from "../domain/reservation";
import type { Deps } from "../ports";
import { cancelReservationByCustomer, findReservationOfCustomer } from "../repo/reservations";
import { customerHome, type CustomerHome } from "./customerHome";

export type CancelByCustomerResult =
  | { ok: true; home: CustomerHome }
  /**
   * 在らない番号・別の客の確保（存在を教えない・設計書の倒し方は `usecases/receiveOffer` と同じ）。
   * 入口は 404・not_found で返す——別の客の確保に 400 を返すと、入力の形が誤っていた場合と見分けがつかず、
   * 「その番号は在る／在らない」を状態コードで言い分けてしまう（要件2の基準 2.4・2.5）。
   */
  | { ok: false; kind: "not_found" }
  /** 確保中でない確保への取り消し（基準 10.3）。状態も残りも変えず、今の状態を返す */
  | { ok: false; kind: "state"; state: EffectiveState };

/** 見分けの直後に登録が消えた場合だけ（入口が 401 に倒す）。 */
export type CancelByCustomerMissing = null;

const notFound: CancelByCustomerResult = { ok: false, kind: "not_found" };

const stateRefusal = (state: EffectiveState): CancelByCustomerResult => ({ ok: false, kind: "state", state });

export const cancelByCustomer = async (deps: Deps, customerId: string, reservationId: string): Promise<CancelByCustomerResult | CancelByCustomerMissing> => {
  const now = deps.clock.now();
  const nowIso = now.toISOString();

  const context = await findReservationOfCustomer(deps.db, reservationId, customerId, nowIso);
  if (!context) return notFound;
  if (!canCancelByCustomer(context.reservation, now)) return stateRefusal(effectiveState(context.reservation, now));

  const cancelled = await cancelReservationByCustomer(deps.db, { reservationId, customerId, nowIso });
  if (!cancelled) {
    // 読んだあとに状態が動いた（店が取り消した・運営が店を止めた）。今の状態をそのまま返す。
    const latest = await findReservationOfCustomer(deps.db, reservationId, customerId, nowIso);
    return latest ? stateRefusal(effectiveState(latest.reservation, now)) : notFound;
  }

  deps.logger.log({ event: "customer_cancel", id: reservationId });

  const home = await customerHome(deps, customerId);
  // 見分けの直後に登録が消えた場合だけ（入口が 401 に倒す）
  if (!home) return null;
  return { ok: true, home };
};
