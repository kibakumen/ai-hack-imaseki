// 店による確保の取り消し（要件21の基準 21.1・21.4・21.5・21.6・21.7、要件18の基準 18.4・18.5、
// 要件22の基準 22.1・22.6、要件27の基準 27.4）。
//
// 順は4つ:
//   1. その店の確保を1件読む（別の店のもの・在らない番号は「無い」として返す）
//   2. 取り消せる状態かを `domain/reservation.canCancelByStore` に聞く（判断はここに書かない）
//   3. **前の状態を WHERE に入れた1つの UPDATE**（同時の完了済み・客の取り消しと競っても2回変わらない）
//   4. 状態の変化を記録し（基準 27.4）、その客へ知らせを送る（基準 22.1）
//
// 残りは戻らず、募集する組数も変わらない（基準 18.4・18.5）——`holds_slot` を触らないことで満たす。
// 取り消しは1件ずつで、同じオファーのほかの確保には触らない（基準 21.4）。

import { canCancelByStore, effectiveState, type EffectiveState } from "../domain/reservation";
import { tokenFromBytes } from "../domain/token";
import type { Deps } from "../ports";
import { insertReservationEvent } from "../repo/logs";
import { cancelReservationByStore, findReservationOfStore } from "../repo/reservations";
import { ID_BYTES } from "../schemas/limits";

export type CancelByStoreResult =
  | { ok: true }
  /** 在らない番号・別の店の確保（入口は 404。どちらなのかは返さない） */
  | { ok: false; kind: "not_found" }
  /** 確保中ではない（基準 21.5・21.6）。今の状態を返して断る（基準 21.7） */
  | { ok: false; kind: "state"; state: EffectiveState };

const newId = (deps: Deps): string => tokenFromBytes(deps.rng.bytes(ID_BYTES));

/**
 * 店がその確保を取り消す。取り消せたら、その客へ「お店の都合で取り消された」を送る（基準 22.1）。
 *
 * **送信が失敗しても取り消しは成立する**（基準 22.6）——D1 の書き込みが済んだあとに送るので、
 * 送る側で何が起きても応答は 200 のままになる。
 */
export const cancelByStore = async (deps: Deps, storeId: string, reservationId: string): Promise<CancelByStoreResult> => {
  const now = deps.clock.now();
  const nowIso = now.toISOString();

  const reservation = await findReservationOfStore(deps.db, reservationId, storeId);
  if (!reservation) return { ok: false, kind: "not_found" };
  if (!canCancelByStore(reservation, now)) return { ok: false, kind: "state", state: effectiveState(reservation, now) };

  const cancelled = await cancelReservationByStore(deps.db, { reservationId, storeId, nowIso });
  if (!cancelled) {
    // 読んでから書くまでの隙に、別の要求（完了済み・客の取り消し）が先に扱われた（基準 20.22）。
    // 今の状態を読み直して断る——状態も残りも変えていない。
    const latest = await findReservationOfStore(deps.db, reservationId, storeId);
    if (!latest) return { ok: false, kind: "not_found" };
    return { ok: false, kind: "state", state: effectiveState(latest, deps.clock.now()) };
  }

  await insertReservationEvent(deps.db, { id: newId(deps), reservationId, status: "store_cancelled", at: nowIso });
  deps.logger.log({ event: "store_cancel", id: reservationId });

  // ⚠️ タスク19 の `pushMessage` をここで呼ぶ（基準 22.1・22.6・22.7）。統合のときは次の1行に差し替える:
  //     await pushMessage(deps, { customerIds: [reservation.customerId], scene: "store_cancelled" });
  //   ・文は `domain/texts.ts` の `TEXTS.push("store_cancelled")` に既に在る（中身はプッシュに載せない）
  //   ・購読の無い客には送らない（基準 22.7）／TTL は20分（基準 22.1）——どちらも `pushMessage` の側
  //   ・**送信の失敗はここで飲み込む**（例外でも「もう無い」でも 200 で返す・基準 22.6）。
  //     取り消しはもう成立しているので、この行より後ろで throw させないこと
  //   ・相手は `reservation.customerId`（上で読んだ行が持っている）

  return { ok: true };
};
