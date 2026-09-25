// 緊急の停止（要件25の基準 25.4・25.6・25.7・25.8・25.11、要件18の基準 18.6、
// 要件22の基準 22.2、要件27の基準 27.4）。
//
// ⚠️ 2026-09-21: タスク8が最小の形（状況の書き換えとオファーの終わり）を置き、**タスク21 が
// 確保の取り消し・その記録・購読のある客へのプッシュを足した**。4つの文は1つのまとまり
// （`db.batch`）で流す——その4文と順番は repo/adminStores の `banApprovedStore` が持つ
// （2026-09-25 監査の指摘 設計-13: 手続きの中から D1 を直接呼んでいたのを repo へ移した）。

import type { Deps } from "../ports";
import { banApprovedStore, findStoreStatus } from "../repo/adminStores";
import type { StoreStatus } from "../repo/stores";
import { newAdminAction, type AdminActor } from "./adminActionRecord";
import { currentStateRefusal } from "./adminStoreConflict";
import { discardLicenseOfBannedStore } from "./license";
import { sendCancellationPushes } from "./pushMessage";

export type BanStoreResult =
  /**
   * 止まった。`cancelled` は取り消した確保の数、`notified` は知らせを送った客の数（購読のある客だけ・
   * 送信の成否は問わない）。運営の画面が「N 組を取り消し、M 人に通知しました」と出す（運営-03）。
   */
  | { ok: true; cancelled: number; notified: number }
  | { ok: false; kind: "not_found" }
  /** 承認済みではない（未承認・もう止められている）。今の状況を返して断る（基準 25.4） */
  | { ok: false; kind: "state"; state: StoreStatus };

/**
 * 止める。状況の書き換え・オファーの終わり・確保の取り消し・その記録は1つのまとまり（`db.batch`）。
 *
 * 取り消した確保の残りは1戻る（基準 18.6）——押さえている条件に `admin_cancelled` が無いので、
 * どこにも数を保存せずに満たす（設計書「確保の状態と、残りの数え方」）。オファーは同時に終わる。
 */
/**
 * 誰が・なぜ止めたか（と取り消した数・通知した人数）を、停止と同じまとまりで記録する（運営-01）。
 * 理由は必須（運営-01 の案2・入口の形の検査が空白だけの理由も断る）。
 */
export const banStore = async (deps: Deps, storeId: string, actor: AdminActor, reason: string): Promise<BanStoreResult> => {
  const status = await findStoreStatus(deps.db, storeId);
  if (!status) return { ok: false, kind: "not_found" };
  if (status !== "approved") return { ok: false, kind: "state", state: status };

  const nowIso = deps.clock.now().toISOString();
  // 取り消した数と通知できる客の数は、停止と同じまとまりの中で数えて記録に添える（repo の banApprovedStore・運営-01）。
  // 先に読んでおくと、読んでから止めるまでに受け取った客が数から漏れる（不具合-13）。
  const action = newAdminAction(deps, actor, "ban", storeId, { reason });

  // 同時に来た操作に負けた・変わった行の数が分からないときは「当たらなかった」側へ倒す（repo/d1 の changedRows）。
  // そのときは今の状況を読み直して返す——先に読んだ approved を返すと、画面が逆の文を出す（運営-04 のレビュー）。
  const banned = await banApprovedStore(deps.db, storeId, nowIso, action);
  if (!banned) return currentStateRefusal(deps, storeId);

  deps.logger.log({ event: "ban_store", id: storeId, actor: actor.accountId });
  // 取り消した確保を1件ずつ残す（`id` は確保の番号。客を指す値は載せない・基準 27.6）。
  for (const reservation of banned.cancelled) deps.logger.log({ event: "admin_cancel", id: reservation.reservationId });

  // 取り消された客へ「運営の都合で取り消された」を知らせる（基準 22.2・22.6・22.7）。
  // 相手は**停止のまとまりが実際に取り消した行**から決める（不具合-13。先に読む形では、読んでから止めるまでに
  // 受け取った客へ届かなかった）。購読のある客に1人1回ずつ・購読の無い客には送らない・
  // 送信の失敗は飲み込む——全部 `sendCancellationPushes` の側。停止はもう成立している。
  await sendCancellationPushes(
    deps,
    banned.cancelled.map((reservation) => reservation.customerId),
  );

  // 止めた店の営業許可書（今の分と承認の写し）を消す（2026-09-25 監査の指摘 安全-20 の案1）。止めることはもう成立している。
  await discardLicenseOfBannedStore(deps, storeId);

  return { ok: true, cancelled: banned.cancelled.length, notified: banned.notified };
};
