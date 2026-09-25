// 店が確保を完了済みにする手続き（要件20の基準 20.6・20.7・20.9・20.11〜20.13・20.19・20.24、
// 要件18の基準 18.7〜18.9、要件27の基準 27.4）。
//
// 順は2つだけ:
//   1. **できる条件を全部入れた1文の UPDATE** と、状態の変化の記録（基準 27.4）を1つのまとまりで書く
//      （`repo/reservations` の `completeReservationIfAllowed`。別々に書くと、途中で落ちたとき記録だけが欠ける・不具合-16）
//   2. 変わらなかったら、読み直して**今の状態**を返す（基準 20.20 の「断った理由」は画面がこれを出す）
//
// 断るときは**何も書かない**（基準 20.19・20.24 の「状態も残りも変えずに断る」）。期限切れの記録も
// ここでは足さない——それは読む側の手続き（店のホーム・客のホーム）の役目（設計書「期限切れの記録」）。
// コードの入力は求めない（基準 20.11）ので、この手続きは入力を取らない。

import { effectiveState, EXPIRED_GRACE_MS, isWithinExpiredGrace, type EffectiveState } from "../domain/reservation";
import type { Deps } from "../ports";
import { findStoreStatus } from "../repo/adminStores";
import { completeReservationIfAllowed, findStoreReservation } from "../repo/reservations";

export type CompleteReservationResult =
  | { ok: true }
  /**
   * 状態による断り（設計書「入口の一覧」の3つ目の形）。画面はこの状態を行の下に出す（基準 20.20）。
   * `newerReservation` は、期限から20分以内の期限切れでも、客が新しく確保し直したので断った印（基準 20.12）——
   * 同じ「期限切れ」を「20分を過ぎた」と取り違えて出さないため（2026-09-25 監査の指摘 店-10）。
   */
  | { ok: false; kind: "state"; state: EffectiveState; newerReservation?: true }
  /** 店が運営に止められている（基準 20.24・20.25）。画面は「運営に止められているため」と出す */
  | { ok: false; kind: "store_banned" }
  /** その店の確保ではない・もう無い。在ることも知らせない（基準 14.9 と同じ倒し方） */
  | { ok: false; kind: "not_found" };

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
    deps.logger.log({ event: "complete", id: reservationId });
    return { ok: true };
  }

  // 断りの理由は読み直して決める（1文の UPDATE が通らなかった理由は、その時点の状態が答え）。
  // 店の状況も読み直す——止められていれば、行の状態より先にそれを理由にする（基準 20.25・店-10。
  // それまでは状態しか返さず、止められた店の期限切れの行は「20分を過ぎた」と取り違えて出ていた）。
  const row = await findStoreReservation(deps.db, reservationId, storeId);
  if (!row) return { ok: false, kind: "not_found" };
  if ((await findStoreStatus(deps.db, storeId)) === "banned") return { ok: false, kind: "store_banned" };
  const state = effectiveState(row, now);
  const newer = state === "expired" && isWithinExpiredGrace(row, now) && row.hasNewerReservation;
  return newer ? { ok: false, kind: "state", state, newerReservation: true } : { ok: false, kind: "state", state };
};
