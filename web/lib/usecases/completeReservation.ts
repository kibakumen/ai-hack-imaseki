// 店が確保を完了済みにする手続き（要件20の基準 20.6・20.7・20.9・20.11〜20.13・20.19・20.24、
// 要件18の基準 18.7〜18.9、要件27の基準 27.4）。
//
// 順は3つだけ:
//   1. **できる条件を全部入れた1文の UPDATE**（`repo/reservations` の `completeReservationIfAllowed`）
//   2. 変わったら、状態の変化を記録する（基準 27.4。記録しないと要件33の割合が数えられない）
//   3. 変わらなかったら、読み直して**今の状態**を返す（基準 20.20 の「断った理由」は画面がこれを出す）
//
// 断るときは**何も書かない**（基準 20.19・20.24 の「状態も残りも変えずに断る」）。期限切れの記録も
// ここでは足さない——それは読む側の手続き（店のホーム・客のホーム）の役目（設計書「期限切れの記録」）。
// コードの入力は求めない（基準 20.11）ので、この手続きは入力を取らない。

import { effectiveState, EXPIRED_GRACE_MS, type EffectiveState } from "../domain/reservation";
import { tokenFromBytes } from "../domain/token";
import type { Deps } from "../ports";
import { insertReservationEvent } from "../repo/logs";
import { completeReservationIfAllowed, findStoreReservation } from "../repo/reservations";
import { ID_BYTES } from "../schemas/limits";

export type CompleteReservationResult =
  | { ok: true }
  /** 状態による断り（設計書「入口の一覧」の3つ目の形）。画面はこの状態を行の下に出す（基準 20.20） */
  | { ok: false; status: 409; current: { state: EffectiveState } }
  /** その店の確保ではない・もう無い。在ることも知らせない（基準 14.9 と同じ倒し方） */
  | { ok: false; status: 404 };

export const completeReservation = async (deps: Deps, storeId: string, reservationId: string): Promise<CompleteReservationResult> => {
  const now = deps.clock.now();
  const nowIso = now.toISOString();

  const completed = await completeReservationIfAllowed(deps.db, {
    reservationId,
    storeId,
    nowIso,
    // 「期限から20分以内」を SQL で比べるための境目（基準 20.7・20.13）。
    // 時刻の計算はここでやり、SQL には束縛した値だけを渡す（SQLite の datetime('now') は使わない）。
    expiredGraceFromIso: new Date(now.getTime() - EXPIRED_GRACE_MS).toISOString(),
  });

  if (completed) {
    await insertReservationEvent(deps.db, { id: tokenFromBytes(deps.rng.bytes(ID_BYTES)), reservationId, status: "completed", at: nowIso });
    deps.logger.log({ event: "complete", id: reservationId });
    return { ok: true };
  }

  // 断りの理由は読み直して決める（1文の UPDATE が通らなかった理由は、その時点の状態が答え）。
  const row = await findStoreReservation(deps.db, reservationId, storeId);
  if (!row) return { ok: false, status: 404 };
  return { ok: false, status: 409, current: { state: effectiveState(row, now) } };
};
