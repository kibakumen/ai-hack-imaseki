// 確保の今の状態（確保中か期限切れか、など）の正本（設計書「どの判断をどこに置くか」）。
// 副作用なし・時計も引数で受け取る。
//
// 保存する status は5つ（`active`・`completed`・`customer_cancelled`・`store_cancelled`・
// `admin_cancelled`）で、**「期限切れ」だけは保存せず時刻から導く**——`status='active'` で
// 期限を過ぎているもの（設計書「確保の状態と、残りの数え方」）。書き込みは起きない（基準 11.1・11.2）。
//
// ⚠️ **このファイルは複数のタスクが順に育てる**（2026-09-21 の並列の実装）。
//    タスク13（ここ）が `effectiveState` と2つの時間の長さを置いた。
//    **タスク15 が `canCancelByCustomer`（要件10）、タスク17 が `canComplete`（要件20の基準
//    20.6・20.7・20.12・20.13・20.19・20.24）、タスク18 が `canCancelByStore`（要件21）** を
//    この同じファイルへ足す（設計書「どの判断をどこに置くか」の行）。**判断を usecases 側に
//    書かないこと**——同じ規則を店の一覧（できる操作のボタン）と入口の断りの両方が読む。

/** 表の `status` 列に入る5つ。 */
export const RESERVATION_STATUSES = ["active", "completed", "customer_cancelled", "store_cancelled", "admin_cancelled"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/** 要件の語の6つ目「期限切れ」は保存せず、時刻から導く。 */
export type EffectiveState = ReservationStatus | "expired";

/** 確保の期限は受け取った時刻から20分後（要件8の基準 8.4）。 */
export const RESERVATION_HOLD_MS = 20 * 60 * 1000;

/**
 * 期限切れのあと、コードを出し続ける・受け取り直せる・店が完了済みにできる長さ（20分）。
 * 客の側（要件11の基準 11.6）と店の側（要件20の基準 20.5・20.7・20.13）で同じ長さ（本人選択）。
 */
export const EXPIRED_GRACE_MS = 20 * 60 * 1000;

/** 状態を導くのに要る確保1行ぶん（表の列と同じ名前）。 */
export type ReservationStateRow = { status: string; expiresAt: Date };

/** 今の状態。`active` で期限を過ぎていれば `expired`（書き込みは伴わない）。 */
export const effectiveState = (row: ReservationStateRow, now: Date): EffectiveState => {
  if (row.status === "active") return row.expiresAt.getTime() > now.getTime() ? "active" : "expired";
  return row.status as ReservationStatus;
};

/** 期限切れになってから20分以内か（期限ちょうど＋20分は、もう外・基準 11.6 と 20.13 を同じ線で切る）。 */
export const isWithinExpiredGrace = (row: ReservationStateRow, now: Date): boolean =>
  now.getTime() - row.expiresAt.getTime() < EXPIRED_GRACE_MS;

// ---------- タスク15（客の取り消しと人数の変更・要件10） ----------

/**
 * 客が取り消せるか（要件10の基準 10.1・10.3）。**確保中の確保だけ**。
 *
 * 完了済み・期限切れ・すでに取り消された確保を断るのは、残りがもう1回戻らないようにするため
 * （要件10の補足）。客の画面が状態の変化を映すのは30秒以内（基準 9.9）なので、期限が切れた直後や
 * 店が取り消した直後に、古い確保中の表示から取り消しが押されることがある。
 */
export const canCancelByCustomer = (row: ReservationStateRow, now: Date): boolean => effectiveState(row, now) === "active";

/**
 * 人数の変更を受け入れられるか（要件10の基準 10.6・10.7・10.9）。
 *
 * 増やす変更だけ「何名まで」以下を求める。**減らす（か同じ）変更は「何名まで」を超えていても通る**
 * ——確保した人数は担保されている（本人発案）ので、それより少ない人数は受け入れられる（基準 10.9。
 * 店が「何名まで」を引き下げたあとの場面のためのもの）。
 *
 * `partyMax` はその時点のオファーの値で、オファーが終わっていれば終わった時点の値（基準 10.6。
 * 終わったオファーへの変更は受け付けないので〔基準 19.12〕、列の値がそのまま「終わった時点」になる）。
 */
export const canChangeParty = (args: { current: number; next: number; partyMax: number }): boolean =>
  args.next <= args.current || args.next <= args.partyMax;
