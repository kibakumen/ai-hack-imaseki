// 客への知らせ（Web プッシュ）の口（要件22）。3つを持つ:
//   1. pushMessage        … Service Worker が取りに来る文面（場面ごとの決まった文・基準 22.4）
//   2. sendCancellationPush(es) … 取り消しを知らせる1回の送信（基準 22.1・22.2・22.6・22.7）
//   3. pushPromptDue      … 客の画面が通知の許可を求めるか（基準 22.8・22.11）
//
// **送るのは確保が店か運営に取り消された2つの場面だけ**（本人選択）。ほかの出来事（期限切れ・客の
// 取り消し・完了済み・公開の停止・受付時間の終わり・公開中の変更）では、この手続きを呼ばない
// ＝呼ばれない側が「送らない」を実現する（基準 22.3）。
//
// 中身を載せないプッシュなので、ここから配信元へ渡すのは購読そのものと TTL だけ。呼び名・電話番号は
// 通らない（基準 22.5）。

import type { Deps } from "../ports";
import { deletePushSubscription, findLatestReservationStatus, findPushSubscription, hasPushSubscription } from "../repo/push";
import { TEXTS } from "../domain/texts";
import { PUSH_TTL_SECONDS } from "../schemas/limits";
import type { PushMessage } from "../schemas/push";
import { raceDeadline } from "./deadline";

/**
 * 1回の送信の打ち切り（値は AI判断・監査の指摘 不具合-08 の「3〜5秒」の間）。ほかの外向きの呼び出し（地図・AI・
 * 人かどうかの確かめ）には全部打ち切りがあるのに、送信にだけ無かった——応答しない配信先を登録した客が1人いるだけで、
 * 店の「取り消す」も運営の停止も戻らず、押し直すと「もう取り消されています」と断られた。
 */
const PUSH_SEND_TIMEOUT_MS = 4000;

/** 文面を出す確保の状態は2つだけ。ほかの状態（確保中・完了済み・期限切れ・客の取り消し）は場面なし。 */
const SCENES: Record<string, string> = { store_cancelled: "store_cancelled", admin_cancelled: "admin_cancelled" };

/** 店が「来ない（枠を戻す）」で取り消した確保の場面（店の都合の文とは別の決まった文・基準 22.4・2026-09-26 本人選択） */
const NO_SHOW_SCENE = "store_no_show";

const sceneOf = (latest: { status: string; cancelReason: string | null } | null): string | undefined => {
  if (latest === null) return undefined;
  if (latest.status === "store_cancelled" && latest.cancelReason === "no_show") return NO_SHOW_SCENE;
  return SCENES[latest.status];
};

/**
 * Service Worker が GET /api/customer/push-message で取りに来る文面。
 * 文を作るのに渡すのは**場面の名前だけ**で、客の登録の内容は渡さない（基準 22.5）。
 */
export const pushMessage = async (deps: Deps, customerId: string): Promise<PushMessage> => {
  const scene = sceneOf(await findLatestReservationStatus(deps.db, customerId));
  if (!scene) return { scene: null, title: null, body: null };
  return { scene, ...TEXTS.push(scene) };
};

/**
 * 取り消しを1人の客へ知らせる。**呼ぶ側の処理は、この結果に関わらず成立する**（基準 22.6）——
 * 投げない・断らない。通知を許可していない客には送信を試みない（基準 22.7）。
 *
 * ⚠️ 呼ぶ側（usecases/cancelByStore・usecases/banStore）は、**確保の状態を変えたあとに** await する。
 * 先に送ると、Service Worker が文面を取りに来た時点でまだ確保中に見える（文面は D1 の状態から作る）。
 */
export const sendCancellationPush = async (deps: Deps, customerId: string): Promise<void> => {
  const subscription = await findPushSubscription(deps.db, customerId);
  if (!subscription) return;
  try {
    // 打ち切りは実時計と差し替えられる時計の両方で数える（usecases/deadline）。打ち切り・例外は「届かなかった」
    // として扱い、購読は消さない（配信元が遅いだけかもしれない）。合図は送る直前に作る（この await の後で）。
    const answer = await raceDeadline(PUSH_SEND_TIMEOUT_MS, deps.clock.after(PUSH_SEND_TIMEOUT_MS), (signal) => deps.push.send(subscription, { ttlSeconds: PUSH_TTL_SECONDS, signal }));
    if (!answer.ok) {
      deps.logger.log({ event: "push.send_failed", errorKind: "timeout_or_exception" });
      return;
    }
    // 配信元が「もう無い」と答えた購読は消す（次の取り消しで無駄に呼ばない）。
    if (!answer.value.ok && answer.value.gone) await deletePushSubscription(deps.db, customerId);
  } catch {
    // 購読の片付けの失敗。取り消しは成立させる（基準 22.6）。
    deps.logger.log({ event: "push.send_failed", errorKind: "exception" });
  }
};

/**
 * 何人かへ1回ずつ（運営が店を止めたとき・基準 22.2）。1人が失敗しても残りは送る。
 * **並べて送る**（不具合-08）——1人ずつ順に待つと、応答しない配信先の客が並ぶほど運営の画面が戻らない。
 * 1人ぶんは打ち切りつきで投げないので、全体も最長で打ち切り1回ぶんで返る。
 */
export const sendCancellationPushes = async (deps: Deps, customerIds: readonly string[]): Promise<void> => {
  await Promise.allSettled(customerIds.map((customerId) => sendCancellationPush(deps, customerId)));
};

/**
 * 客の画面が通知の許可を求めるか（基準 22.8）。まだ許可していない客だけ true。
 * **確保中の表示のときだけ画面が使う**ので、「はじめての受け取りが済んだ直後」になる。
 * 「今はしない」と答えた客に二度と出さないのは端末が覚える（基準 22.11・`client/push` の注）。
 */
export const pushPromptDue = async (deps: Deps, customerId: string): Promise<boolean> => !(await hasPushSubscription(deps.db, customerId));
