// 緊急の停止（要件25の基準 25.4・25.6・25.7・25.8・25.11、要件18の基準 18.6、
// 要件22の基準 22.2、要件27の基準 27.4）。
//
// ⚠️ 2026-09-21: タスク8が最小の形（状況の書き換えとオファーの終わり）を置き、**タスク21 が
// 確保の取り消し・その記録・購読のある客へのプッシュを足した**。4つの文は1つのまとまり
// （`db.batch`）で流す——止められた店に公開中のオファーが残る／オファーは終わったのに確保だけ
// 確保中で残る、という形を作らないため。
//
// **文の順に意味が在る**（記録の文がまだ `status='active'` の行を選ぶので、状態を変える文より前）:
//   1. 店の状況を banned にする（前の状況 approved を WHERE に入れた1つの UPDATE）
//   2. 公開中のオファーを終わりにする（終わった理由は banned・基準 25.7）
//   3. これから取り消す確保の、状態の変化の記録を足す（基準 27.4）
//   4. 確保中の確保を全部「運営に取り消された」にする（基準 25.8・25.11）

import type { Deps } from "../ports";
import { banStoreStatement, endPublishedOffersStatement, findStoreStatus } from "../repo/adminStores";
import { adminCancelledEventsStatement } from "../repo/logs";
import { adminCancelReservationsStatement, listActiveReservationsOfStore } from "../repo/reservations";
import type { StoreStatus } from "../repo/stores";

export type BanStoreResult =
  | { ok: true }
  | { ok: false; kind: "not_found" }
  /** 承認済みではない（未承認・もう止められている）。今の状況を返して断る（基準 25.4） */
  | { ok: false; kind: "state"; state: StoreStatus };

/**
 * 止める。状況の書き換え・オファーの終わり・確保の取り消し・その記録は1つのまとまり（`db.batch`）。
 *
 * 取り消した確保の残りは1戻る（基準 18.6）——押さえている条件に `admin_cancelled` が無いので、
 * どこにも数を保存せずに満たす（設計書「確保の状態と、残りの数え方」）。オファーは同時に終わる。
 */
export const banStore = async (deps: Deps, storeId: string): Promise<BanStoreResult> => {
  const status = await findStoreStatus(deps.db, storeId);
  if (!status) return { ok: false, kind: "not_found" };
  if (status !== "approved") return { ok: false, kind: "state", state: status };

  const nowIso = deps.clock.now().toISOString();
  // 知らせの相手は**取り消す前に**読む（取り消したあとでは「確保中だった客」を選べない・基準 22.2）。
  const affected = await listActiveReservationsOfStore(deps.db, storeId, nowIso);

  const [banned] = await deps.db.batch([
    banStoreStatement(deps.db, storeId),
    endPublishedOffersStatement(deps.db, storeId, nowIso),
    adminCancelledEventsStatement(deps.db, storeId, nowIso),
    adminCancelReservationsStatement(deps.db, storeId, nowIso),
  ]);
  const changes: unknown = banned?.meta?.changes;
  if (typeof changes === "number" && changes === 0) return { ok: false, kind: "state", state: status };

  deps.logger.log({ event: "ban_store", id: storeId });
  // 取り消した確保を1件ずつ残す（`id` は確保の番号。客を指す値は載せない・基準 27.6）。
  for (const reservation of affected) deps.logger.log({ event: "admin_cancel", id: reservation.id });

  // ⚠️ タスク19 の `pushMessage` をここで呼ぶ（基準 22.2・22.6・22.7）。統合のときは次の1行に差し替える:
  //     await pushMessage(deps, { customerIds: affected.map((r) => r.customerId), scene: "admin_cancelled" });
  //   ・文は `domain/texts.ts` の `TEXTS.push("admin_cancelled")` に既に在る（店の取り消しとは違う文）
  //   ・購読のある客に**1人1回ずつ**（基準 22.2）。購読の無い客には送らない（基準 22.7）
  //   ・**送信の失敗はここで飲み込む**（基準 22.6）。停止はもう成立しているので throw させないこと

  return { ok: true };
};
