// reservations の表への読み書きのうち、店の側（要件20 向かっている客・完了済み、要件21 店の取り消し、要件25 運営の取り消し）。
// 2026-09-25 監査の指摘 設計-16 で repo/reservations.ts から分けた（SQL は変えていない）。状態を変える操作は、どれも
// **1つの UPDATE（前の状態を WHERE に入れる）** で書く。確保1行の形と列は repo/reservations.ts が持つ。
//
// ⚠️ 確保の表の別名は **`res`** で固定する（repo/reservations.ts の注）。

import type { Deps } from "../ports";
import { changedRows } from "./d1";
import { reservationEventStatement } from "./logs";
import { activeReservationCondition, expiredWithinGraceCondition, remainingExpression } from "./sqlFragments";
import { RESERVATION_COLUMNS, toReservationRow, type ReservationRow } from "./reservations";

type Db = Deps["db"];

// ---------- 読む（向かっている客の一覧・完了済みの断りの理由。タスク17） ----------

/** 一覧の行1つぶん（`domain/storeHome` の `ArrivalRowInput` と同じ形。時刻は Date に直してある）。 */
export type ArrivalReservationRow = {
  reservationId: string;
  status: string;
  expiresAt: Date;
  statusAt: Date;
  nickname: string;
  /** 受け取った時点の電話番号の写し（安全-17）。写しが無い（写す前の行・消去した客）なら空 */
  phone: string;
  party: number;
  code: string;
  hasNewerReservation: boolean;
};

/**
 * その客が、この確保より後に別の確保を作ったか（基準 20.12・20.7）。
 * 同じ時刻に2件入ったときは、あとから入った行（`rowid` が大きい方）を「後」とする。
 */
const HAS_NEWER_RESERVATION = (alias: string): string =>
  `EXISTS (SELECT 1 FROM reservations n WHERE n.customer_id = ${alias}.customer_id` +
  ` AND (n.created_at > ${alias}.created_at OR (n.created_at = ${alias}.created_at AND n.rowid > ${alias}.rowid)))`;

/**
 * 一覧に出しうる確保を読む（要件20の基準 20.1・20.5・20.14〜20.16）。
 *
 * **どの行を出すか・どう見せるかは決めない**——それは `domain/storeHome` の `arrivalRows`。
 * ここでやるのは3つだけ: ①自分の店の確保に絞る ②出す見込みの無い状態を落とす（運営に取り消された・
 * 基準 20.15。客が取り消した行は10分だけ出すので読む・横断-08）③読む幅を `sinceIso` で切る（残り方の
 * いちばん長い24時間ぶん。これが無いと店の一覧が日ごとに重くなる）。①と③は索引
 * `idx_reservations_store_status_at`（migrations/0004）で引く（設計-08）。
 *
 * 電話番号は**確保の行の写し**（`res.customer_phone`・受け取った時点の値）を読み、客の今の番号は読まない
 * （安全-17 の案1: あとから入れた番号が、前に受け取った店の「済んだぶん」に出ていた）。呼び名は客の今の値。
 */
export const listStoreArrivals = async (db: Db, storeId: string, sinceIso: string): Promise<ArrivalReservationRow[]> => {
  const result = await db
    .prepare(
      `SELECT ${RESERVATION_COLUMNS}, c.nickname AS customer_nickname, res.customer_phone AS customer_phone,` +
        ` ${HAS_NEWER_RESERVATION("res")} AS has_newer` +
        ` FROM reservations res` +
        ` JOIN customers c ON c.id = res.customer_id` +
        ` WHERE res.store_id = ?1 AND res.status <> 'admin_cancelled'` +
        ` AND res.status_at >= ?2`,
    )
    .bind(storeId, sinceIso)
    .all();
  return ((result.results ?? []) as Array<Record<string, unknown>>).map((row) => {
    const reservation = toReservationRow(row);
    return {
      reservationId: reservation.id,
      status: reservation.status,
      expiresAt: reservation.expiresAt,
      statusAt: reservation.statusAt,
      nickname: (row.customer_nickname as string | null) ?? "",
      phone: (row.customer_phone as string | null) ?? "",
      party: reservation.party,
      code: reservation.code,
      hasNewerReservation: Number(row.has_newer ?? 0) === 1,
    };
  });
};

/** 完了済みにできるかの判断と、断りの理由の読み直しに要るぶん。別の店の確保なら null（基準 14.9）。 */
export type StoreReservationRow = { status: string; expiresAt: Date; hasNewerReservation: boolean };

export const findStoreReservation = async (db: Db, reservationId: string, storeId: string): Promise<StoreReservationRow | null> => {
  const row = await db
    .prepare(`SELECT res.status, res.expires_at, ${HAS_NEWER_RESERVATION("res")} AS has_newer FROM reservations res WHERE res.id = ?1 AND res.store_id = ?2`)
    .bind(reservationId, storeId)
    .first();
  if (!row) return null;
  const r = row as Record<string, unknown>;
  return { status: r.status as string, expiresAt: new Date(r.expires_at as string), hasNewerReservation: Number(r.has_newer ?? 0) === 1 };
};

// ---------- 書く（完了済みにする。タスク17） ----------

/**
 * 完了済みにする1文の UPDATE（設計書「確保の状態と、残りの数え方」の「完了済み」の行）と、その記録。変わったら true。
 *
 * **できる条件を全部この1つの文の WHERE に入れる**ので、読んでから書くまでの隙に別の出来事
 * （客の取り消し・店の取り消し・もう1人の店員の完了済み）が入っても、状態が二重に変わることは
 * ない（基準 20.22・18.11）。判断の正本は `domain/reservation` の `canComplete` で、この WHERE は
 * その SQL 版——**どちらかを直したら両方直す**（突き合わせは受け入れ検査 r20）:
 *   ①確保中（`status='active'` で期限より前・基準 20.6）
 *   ②期限切れで、期限から20分以内（`expires_at > 今-20分`・基準 20.7・20.13）で、
 *     客が新しい確保を作っていない（基準 20.12）
 *   ③どちらの場合も、店が運営に止められていない（基準 20.24）
 *
 * 枠の押さえ方（残り）は要件18の基準 18.7〜18.9:
 *   確保中からの完了済み  … 押さえたまま（`holds_slot` は 1 のまま）＝残りは動かない（18.9）
 *   期限切れからの完了済み … 残りが1以上なら押さえ直して1減らし（18.7）、0なら押さえずに0のまま（18.8）
 *
 * 状態の変化の記録（基準 27.4）は同じ `db.batch` の並びで書く（不具合-16）。
 */
export const completeReservationIfAllowed = async (
  db: Db,
  input: { reservationId: string; storeId: string; nowIso: string; expiredGraceFromIso: string },
): Promise<boolean> => {
  const remainingOfOffer = `(SELECT ${remainingExpression("o", "?3")} FROM offers o WHERE o.id = reservations.offer_id)`;
  const update = db
    .prepare(
      `UPDATE reservations SET` +
        ` status = 'completed',` +
        ` status_at = ?3,` +
        ` completed_after_expiry = CASE WHEN reservations.expires_at > ?3 THEN 0 ELSE 1 END,` +
        ` holds_slot = CASE WHEN reservations.expires_at > ?3 THEN 1 WHEN ${remainingOfOffer} >= 1 THEN 1 ELSE 0 END` +
        ` WHERE reservations.id = ?1 AND reservations.store_id = ?2` +
        ` AND ((${activeReservationCondition("reservations", "?3")})` +
        ` OR (${expiredWithinGraceCondition("reservations", "?3", "?4")} AND NOT ${HAS_NEWER_RESERVATION("reservations")}))` +
        ` AND NOT EXISTS (SELECT 1 FROM stores s WHERE s.id = reservations.store_id AND s.status = 'banned')`,
    )
    .bind(input.reservationId, input.storeId, input.nowIso, input.expiredGraceFromIso);
  const [updated] = await db.batch([update, reservationEventStatement(db, { reservationId: input.reservationId, status: "completed", at: input.nowIso })]);
  return changedRows(updated) > 0;
};
// ---------- 店が取り消す（タスク18・要件21） ----------

/**
 * 番号で1件。**その店のものでなければ null**（別の店の確保は触れない・入口は 404 に倒す）。
 * 残りは見ないので、`findReservationOfCustomer` と違ってオファーとも店とも繋がない。
 */
export const findReservationOfStore = async (db: Db, reservationId: string, storeId: string): Promise<ReservationRow | null> => {
  const row = await db.prepare(`SELECT ${RESERVATION_COLUMNS} FROM reservations res WHERE res.id = ?1 AND res.store_id = ?2`).bind(reservationId, storeId).first();
  return row ? toReservationRow(row as Record<string, unknown>) : null;
};

/**
 * 店が取り消す（基準 21.1・21.4）と、その記録。入ったら true。
 *
 * **前の状態（確保中で期限より前）を WHERE に全部入れた1つの UPDATE** なので、同じ確保へ
 * 完了済み・客の取り消し・店の取り消しが同時に来ても、状態が2回変わることはない（基準 20.22）。
 *
 * `holds_slot` は触らない——店が取り消した確保は枠を押さえたままで、残りも募集する組数も
 * 戻らない（基準 18.4・18.5。押さえている条件の3つ目は `sqlFragments.holdsSlotCondition`）。
 * 状態の変化の記録（基準 27.4）は同じ `db.batch` の並びで書く（不具合-16）。
 */
export const cancelReservationByStore = async (db: Db, input: { reservationId: string; storeId: string; nowIso: string }): Promise<boolean> => {
  const update = db
    .prepare(
      // 別名を付けずに表の名前で条件を書く（`endPublishedOffersStatement` と同じ形。UPDATE の
      // 別名は SQLite の版に依るので、確実な側に寄せた）。
      `UPDATE reservations SET status = 'store_cancelled', status_at = ?3` +
        ` WHERE reservations.id = ?1 AND reservations.store_id = ?2 AND ${activeReservationCondition("reservations", "?3")}`,
    )
    .bind(input.reservationId, input.storeId, input.nowIso);
  const [updated] = await db.batch([update, reservationEventStatement(db, { reservationId: input.reservationId, status: "store_cancelled", at: input.nowIso })]);
  return changedRows(updated) > 0;
};

// ---------- 運営が店を止める（タスク21・要件25の基準 25.8） ----------

/**
 * その店の確保中の確保を全部「運営に取り消された」にする1つの UPDATE（基準 25.8・25.11）。
 * `db.batch` の並びに入れて、状況の書き換えとオファーの終わりと同じまとまりで流す。
 *
 * 期限切れの確保は変えない（枠をもう押さえておらず、店はまだ完了済みにできる・基準 20.7）。
 * `holds_slot` は触らないが、押さえている条件に `admin_cancelled` は無いので残りは1戻る（基準 18.6）。
 *
 * **取り消した確保の番号と客の番号を返す**（`RETURNING`・不具合-13）。知らせの相手（基準 22.2）は、
 * 取り消す前に読んでおくのではなく、この文が実際に取り消した行から決める——前に読む形では、読んでから
 * 止めるまでの間に受け取った客へ知らせが届かなかった。
 */
export const adminCancelReservationsStatement = (db: Db, storeId: string, nowIso: string) =>
  db
    .prepare(
      `UPDATE reservations SET status = 'admin_cancelled', status_at = ?2` +
        ` WHERE reservations.store_id = ?1 AND ${activeReservationCondition("reservations", "?2")}` +
        ` RETURNING reservations.id AS id, reservations.customer_id AS customer_id`,
    )
    .bind(storeId, nowIso);

// ---------- 店が退会する（2026-09-26 本人発案・要件13の基準 13.17） ----------

/**
 * その店の確保中の確保を全部「店が取り消した」にする1つの UPDATE。運営の停止（上）と同じく `db.batch` の並びに入れ、
 * 取り消した行（番号と客の番号）を返す——知らせの相手は、この文が実際に取り消した行から決める（不具合-13 と同じ理由）。
 *
 * 状態を `admin_cancelled` でなく `store_cancelled` にするのは、客への文面を「お店の都合で取り消されました」にするため
 * （退会は運営の判断ではない・AI判断）。オファーは同じまとまりで終わるので、残りの数え方（`store_cancelled` は枠を押さえる）は
 * 客に見えない。退会の1文目が当たったまとまりでだけ当たる（`withdrawn_at = ?2`・repo/storeWithdrawal の注）。
 */
export const withdrawCancelReservationsStatement = (db: Db, storeId: string, nowIso: string) =>
  db
    .prepare(
      `UPDATE reservations SET status = 'store_cancelled', status_at = ?2` +
        ` WHERE reservations.store_id = ?1 AND ${activeReservationCondition("reservations", "?2")}` +
        ` AND EXISTS (SELECT 1 FROM stores ws WHERE ws.id = ?1 AND ws.withdrawn_at = ?2)` +
        ` RETURNING reservations.id AS id, reservations.customer_id AS customer_id`,
    )
    .bind(storeId, nowIso);

/**
 * その店の確保に写した客の電話番号を空にする（退会のまとまりの中）。写しは店の画面に出すためだけのもの（安全-17）で、
 * 見る店がもう無い。運営の画面にも客の画面にも出ない値なので、残す理由が無い（AI判断）。
 */
export const clearCustomerPhonesOfWithdrawnStoreStatement = (db: Db, storeId: string, nowIso: string) =>
  db
    .prepare(
      `UPDATE reservations SET customer_phone = NULL` +
        ` WHERE reservations.store_id = ?1 AND reservations.customer_phone IS NOT NULL` +
        ` AND EXISTS (SELECT 1 FROM stores ws WHERE ws.id = ?1 AND ws.withdrawn_at = ?2)`,
    )
    .bind(storeId, nowIso);
