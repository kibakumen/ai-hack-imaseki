// 読み上げの領域（`CustomerApp` の role=status）へ入れる文（2026-09-25 監査の指摘 客-08）。
//
// 画面を見られない客にも、探せたのか・確保できたのか・取り消されたのかが伝わるように、画面の変化を1文で言う。
// 表示そのものの文（見出し）と同じことを言い、新しい事実は足さない。

import type { HomeDto } from "./home";
import { ADMIN_CANCELLED_TEXT } from "./AdminCancelledView";
import { NO_SHOW_CANCELLED_TEXT, STORE_CANCELLED_TEXT } from "./StoreCancelledView";

/** 結果が届いたとき（0件は「今すぐ探す」の下の知らせ（role=alert）が言うので、ここでは言わない） */
export const resultsMessage = (count: number): string => `${count}件のお店が見つかりました。結果の一覧へ移りました。`;

/** 受け取りが通ったとき */
export const claimedMessage = (code: string): string => `席を確保しました。確保番号は ${code} です。お店でこの番号を見せてください。`;

/**
 * 確保中の確保が、取り直しで別の状態に変わったとき（変わった先の表示の見出しと同じことを言う）。
 * 店の取り消しは理由（来店なし・基準 9.14）で見出しが分かれるので、確保も受け取る。
 */
export const changedMessage = (kind: HomeDto["kind"], reservation?: HomeDto["reservation"]): string | null => {
  if (kind === "store_cancelled") return `${reservation?.cancelReason === "no_show" ? NO_SHOW_CANCELLED_TEXT : STORE_CANCELLED_TEXT}。`;
  if (kind === "admin_cancelled") return `${ADMIN_CANCELLED_TEXT}。`;
  if (kind === "expired") return "確保の期限が切れました。";
  if (kind === "completed") return "来店が完了しました。";
  return null;
};
