// 客の登録そのものについての判断（要件28の基準 28.5）。副作用なし・時計は引数で受け取る
// （設計書「どの判断をどこに置くか」）。
//
// 消せない場合が**2つ**ある（設計書「反論役が挙げた見落としへの答え」の 637 行）:
//   ①確保中の確保がある（基準 28.5）——消すと同時に取り消すと、客は席を手放したことに気づかない
//   ②期限から20分以内の期限切れの確保がある（17節の持ち越し）——その間はまだ店頭でコードを
//     見せられるので（要件11の基準 11.6）、消すと店頭で見せる画面を失う
// 判断を `usecases/deleteCustomer` に書かないのは、同じ規則を画面の側（消せるかどうかの見せ方）
// が後から読めるようにするため。

import { effectiveState, isWithinExpiredGrace, type ReservationStateRow } from "./reservation";

/** 消せないと判断した理由（今は1つだけ。画面は `domain/texts` で文に直す）。 */
export type DeleteRefusalKind = "has_active_reservation";

export type DeleteRegistrationDecision = { ok: true } | { ok: false; kind: DeleteRefusalKind };

/**
 * その客の確保を全部渡して、登録を消せるかを決める。
 * 確保中の確保も、期限から20分以内の期限切れの確保も無ければ消せる。
 */
export const canDeleteRegistration = (reservations: ReservationStateRow[], now: Date): DeleteRegistrationDecision => {
  const blocking = reservations.some((row) => {
    const state = effectiveState(row, now);
    if (state === "active") return true;
    return state === "expired" && isWithinExpiredGrace(row, now);
  });
  return blocking ? { ok: false, kind: "has_active_reservation" } : { ok: true };
};
