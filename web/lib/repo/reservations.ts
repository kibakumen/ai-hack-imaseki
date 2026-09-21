// reservations の表への読み書き（設計書「ファイル構成の計画」: lib/repo は D1 の SQL）。
// 「公開中」「枠を押さえている確保」「残り」の条件は repo/sqlFragments.ts のただ1つの置き場から組む。
// 時刻の比較は、手続きが束縛した「今」を引数で受ける（SQLite の datetime('now') は使わない）。
//
// ⚠️ 確保の表の別名は **`res`** で固定する（`r` は使わない）——`remainingExpression` の中の
//    副問い合わせが `reservations r` を使うので、外側でも `r` を使うと読む人が取り違える。
//
// ⚠️ **このファイルは受け取り系のタスクが順に育てる**（2026-09-21 の並列の実装）。
//    タスク13（ここ）が受け取りの1文の INSERT と、客のホーム／受け取り直しが要る読みを置いた。
//    タスク15（客の取り消し・人数の変更）・タスク17（向かっている客・完了済み）・タスク18（店の
//    取り消し）・タスク21（運営の停止）・タスク23（店の実績）・タスク30（過去の受け取り）は、
//    **状態を変える1つの UPDATE（前の状態を WHERE に入れる）** をここへ足す形で書く。
//    `RESERVATION_COLUMNS` と `toReservationRow` を使い回せば、列の名前を写さずに済む。

import type { Deps } from "../ports";
import { activeReservationCondition, publishingOfferCondition, remainingExpression } from "./sqlFragments";

type Db = Deps["db"];

const changedRows = (result: unknown): number => {
  const meta = (result as { meta?: { changes?: number } } | null)?.meta;
  return Number(meta?.changes ?? 0);
};

/** 壊れた JSON は「1つも無い」として読む（画面が止まらないようにする）。 */
const parseCoupons = (raw: unknown): Array<{ name: string; note: string }> => {
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      if (typeof value !== "object" || value === null) return [];
      const coupon = value as { name?: unknown; note?: unknown };
      return [{ name: typeof coupon.name === "string" ? coupon.name : "", note: typeof coupon.note === "string" ? coupon.note : "" }];
    });
  } catch {
    return [];
  }
};

// ---------- 読む（客のホーム・受け取り直し・断りの理由の読み直し） ----------

/** 確保1行ぶん（表の列と同じ。時刻は Date に直してある）。 */
export type ReservationRow = {
  id: string;
  offerId: string;
  storeId: string;
  customerId: string;
  fetchId: string;
  party: number;
  code: string;
  createdAt: Date;
  expiresAt: Date;
  status: string;
  statusAt: Date;
  holdsSlot: number;
  coupons: Array<{ name: string; note: string }>;
};

/** その確保の店（客のホームが出す項目・基準 9.1・9.2）。 */
export type ReservationStore = { id: string; name: string; address: string; url: string | null; banned: boolean };

/** その確保のオファーの今（受け取り直せるか・断りの理由の判断に使う）。 */
export type ReservationOffer = { endedAt: Date | null; untilAt: Date; remaining: number; partyMax: number };

export type ReservationContext = { reservation: ReservationRow; store: ReservationStore; offer: ReservationOffer };

/** 確保の列（`res` の別名で読む。列の名前を写さないため、読む側はこれを使う）。 */
export const RESERVATION_COLUMNS =
  `res.id, res.offer_id, res.store_id, res.customer_id, res.fetch_id, res.party, res.code,` +
  ` res.created_at, res.expires_at, res.status, res.status_at, res.holds_slot, res.coupons_json`;

export const toReservationRow = (row: Record<string, unknown>): ReservationRow => ({
  id: row.id as string,
  offerId: row.offer_id as string,
  storeId: row.store_id as string,
  customerId: row.customer_id as string,
  fetchId: row.fetch_id as string,
  party: Number(row.party ?? 0),
  code: (row.code as string | null) ?? "",
  createdAt: new Date(row.created_at as string),
  expiresAt: new Date(row.expires_at as string),
  status: row.status as string,
  statusAt: new Date(row.status_at as string),
  holdsSlot: Number(row.holds_slot ?? 0),
  coupons: parseCoupons(row.coupons_json),
});

const CONTEXT_SQL = (where: string): string =>
  `SELECT ${RESERVATION_COLUMNS},` +
  ` s.name AS store_name, s.address AS store_address, s.url AS store_url, s.status AS store_status,` +
  ` o.ended_at, o.until_at, o.party_max, ${remainingExpression("o", "?2")} AS remaining` +
  ` FROM reservations res` +
  ` JOIN stores s ON s.id = res.store_id` +
  ` JOIN offers o ON o.id = res.offer_id` +
  ` WHERE ${where}` +
  ` ORDER BY res.created_at DESC, res.rowid DESC LIMIT 1`;

const toContext = (row: Record<string, unknown>): ReservationContext => ({
  reservation: toReservationRow(row),
  store: {
    id: row.store_id as string,
    name: (row.store_name as string | null) ?? "",
    address: (row.store_address as string | null) ?? "",
    url: (row.store_url as string | null) ?? null,
    banned: row.store_status === "banned",
  },
  offer: {
    endedAt: row.ended_at ? new Date(row.ended_at as string) : null,
    untilAt: new Date(row.until_at as string),
    remaining: Number(row.remaining ?? 0),
    partyMax: Number(row.party_max ?? 0),
  },
});

/** その客のいちばん新しい確保と、その店・そのオファーの今。1件も無ければ null。 */
export const findLatestReservation = async (db: Db, customerId: string, nowIso: string): Promise<ReservationContext | null> => {
  const row = await db.prepare(CONTEXT_SQL("res.customer_id = ?1")).bind(customerId, nowIso).first();
  return row ? toContext(row as Record<string, unknown>) : null;
};

/** 番号で1件。**その客のものでなければ null**（別の客の確保は触れない・基準 2.5）。 */
export const findReservationOfCustomer = async (db: Db, reservationId: string, customerId: string, nowIso: string): Promise<ReservationContext | null> => {
  const row = await db.prepare(CONTEXT_SQL("res.id = ?3 AND res.customer_id = ?1")).bind(customerId, nowIso, reservationId).first();
  return row ? toContext(row as Record<string, unknown>) : null;
};

/** 断りの理由の読み直しに使う、オファーの今と店の状況。オファーが無ければ null。 */
export const findOfferForReceive = async (db: Db, offerId: string, nowIso: string): Promise<{ offer: ReservationOffer; storeBanned: boolean } | null> => {
  const row = await db
    .prepare(
      `SELECT o.ended_at, o.until_at, o.party_max, ${remainingExpression("o", "?2")} AS remaining, s.status AS store_status` +
        ` FROM offers o JOIN stores s ON s.id = o.store_id WHERE o.id = ?1`,
    )
    .bind(offerId, nowIso)
    .first();
  if (!row) return null;
  const r = row as Record<string, unknown>;
  return {
    offer: {
      endedAt: r.ended_at ? new Date(r.ended_at as string) : null,
      untilAt: new Date(r.until_at as string),
      remaining: Number(r.remaining ?? 0),
      partyMax: Number(r.party_max ?? 0),
    },
    storeBanned: r.store_status === "banned",
  };
};

/** その客が確保中の確保を持っているか（基準 8.8。期限切れは数えない・基準 8.9）。 */
export const hasActiveReservation = async (db: Db, customerId: string, nowIso: string): Promise<boolean> => {
  const row = await db
    .prepare(`SELECT 1 AS found FROM reservations res WHERE res.customer_id = ?1 AND res.status = 'active' AND res.expires_at > ?2 LIMIT 1`)
    .bind(customerId, nowIso)
    .first();
  return row !== null;
};

/** そのコードが既に使われているか（完了済み・取り消された確保のものも含む・基準 8.3）。 */
export const isCodeTaken = async (db: Db, code: string): Promise<boolean> => {
  const row = await db.prepare(`SELECT 1 AS found FROM reservations WHERE code = ?1 LIMIT 1`).bind(code).first();
  return row !== null;
};

/**
 * 受け取る前に読む、そのオファーの店と「見せているクーポン」の写し（基準 16.6・4.8 の並び）。
 * 確保が写しを持つので、あとで店がクーポンを編集・削除しても確保の中身は変わらない。
 * オファーが無ければ null（受け取りの断りへ倒す）。
 */
export const findOfferSnapshot = async (db: Db, offerId: string): Promise<{ storeId: string; coupons: Array<{ name: string; note: string }> } | null> => {
  const offer = await db.prepare(`SELECT store_id FROM offers WHERE id = ?1`).bind(offerId).first();
  if (!offer) return null;
  const result = await db
    .prepare(
      `SELECT c.name, c.note FROM coupons c` +
        ` WHERE c.store_id = (SELECT o.store_id FROM offers o WHERE o.id = ?1)` +
        ` AND EXISTS (SELECT 1 FROM json_each((SELECT o.coupon_ids FROM offers o WHERE o.id = ?1)) WHERE json_each.value = c.id)` +
        ` ORDER BY c.created_at, c.rowid`,
    )
    .bind(offerId)
    .all();
  return {
    storeId: (offer as { store_id: string }).store_id,
    coupons: ((result.results ?? []) as Array<Record<string, unknown>>).map((row) => ({
      name: (row.name as string | null) ?? "",
      note: (row.note as string | null) ?? "",
    })),
  };
};

/**
 * その客が最後に取得を押した時刻（要件27の記録から）。1度も押していなければ null。
 *
 * ⚠️ 読むのは記録の表（fetch_logs）だが、repo/logs.ts には**追加の文しか置かない**と決めてある
 * （基準 27.7・構造の検査）ので、読み口はこちらに置いた。使うのは客のホームの優先の順の4
 * （取り消しの表示は、そのあと取得を押していないときだけ出す・設計書「客の画面」）。
 */
/**
 * その取得の記録が在って、その客のものか（受け取りの `fetchId` の確かめ）。
 *
 * `reservations.fetch_id` は取得の記録を指す（外部の鍵）ので、在らない番号で受け取ろうとすると
 * INSERT が落ちる。落ちる前に入力の断りへ倒すために見る（要件29——どんな入力でも落ちない）。
 */
export const fetchLogBelongsTo = async (db: Db, fetchId: string, customerId: string): Promise<boolean> => {
  const row = await db.prepare(`SELECT 1 AS found FROM fetch_logs WHERE id = ?1 AND customer_id = ?2 LIMIT 1`).bind(fetchId, customerId).first();
  return row !== null;
};

export const findLastFetchAt = async (db: Db, customerId: string): Promise<Date | null> => {
  const row = await db.prepare(`SELECT MAX(at) AS last_at FROM fetch_logs WHERE customer_id = ?1`).bind(customerId).first();
  const value = (row as { last_at?: unknown } | null)?.last_at;
  return typeof value === "string" && value !== "" ? new Date(value) : null;
};

// ---------- 書く（受け取り・受け取り直し） ----------

export type NewReservation = {
  id: string;
  offerId: string;
  customerId: string;
  fetchId: string;
  party: number;
  code: string;
  nowIso: string;
  expiresAtIso: string;
  /** 受け取った時点のクーポンの写し（JSON の文字列） */
  couponsJson: string;
};

/**
 * 受け取りの1文の INSERT（設計書「確保の状態と、残りの数え方」の「受け取り」の行）。入ったら true。
 *
 * 3つの条件を**1つの文の WHERE に全部入れる**ので、読んでから書くまでの隙に別の要求が入っても、
 * 残りを超えて確保が作られることはない（基準 8.7・18.11）:
 *   ①そのオファーが受け取れる状態（店が承認済み・公開中・残りが1以上）
 *   ②人数がその時点の「何名まで」以下（基準 8.6。取得のあとに店が下げていることがある）
 *   ③その客に確保中の確保が無い（基準 8.8。期限切れ・完了済み・取り消された確保は数えない・8.9）
 * 距離と予算は見ない（基準 8.6 の補足——結果に出た時点で通っており、歩いた客を断る理由が無い）。
 *
 * 店の状況も見る（止められている店から受け取らせない）。運営が店を止めるとオファーも終わるので、
 * これは受け取れる状態の判断を二重に持つものではない（設計書「オファーの状態」）。
 */
export const insertReservationIfReceivable = async (db: Db, input: NewReservation): Promise<boolean> => {
  const result = await db
    .prepare(
      `INSERT INTO reservations (id, offer_id, store_id, customer_id, fetch_id, party, code, created_at, expires_at, status, status_at, holds_slot, completed_after_expiry, coupons_json)` +
        ` SELECT ?1, o.id, o.store_id, ?2, ?3, ?4, ?5, ?6, ?7, 'active', ?6, 1, 0, ?8` +
        ` FROM offers o JOIN stores s ON s.id = o.store_id` +
        ` WHERE o.id = ?9` +
        ` AND s.status = 'approved'` +
        ` AND ${publishingOfferCondition("o", "?6")}` +
        ` AND ${remainingExpression("o", "?6")} >= 1` +
        ` AND ?4 <= o.party_max` +
        ` AND NOT EXISTS (SELECT 1 FROM reservations ar WHERE ar.customer_id = ?2 AND ar.status = 'active' AND ar.expires_at > ?6)`,
    )
    .bind(input.id, input.customerId, input.fetchId, input.party, input.code, input.nowIso, input.expiresAtIso, input.couponsJson, input.offerId)
    .run();
  return changedRows(result) > 0;
};

// ---------- 読む（向かっている客の一覧・完了済みの断りの理由。タスク17） ----------

/** 一覧の行1つぶん（`domain/storeHome` の `ArrivalRowInput` と同じ形。時刻は Date に直してある）。 */
export type ArrivalReservationRow = {
  reservationId: string;
  status: string;
  expiresAt: Date;
  statusAt: Date;
  nickname: string;
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
 * ここでやるのは3つだけ: ①自分の店の確保に絞る ②出す見込みの無い2つの状態を落とす（客が
 * 取り消した・運営に取り消された・基準 20.15）③読む幅を `sinceIso` で切る（残り方の
 * いちばん長い24時間ぶん。これが無いと店の一覧が日ごとに重くなる）。
 */
export const listStoreArrivals = async (db: Db, storeId: string, sinceIso: string): Promise<ArrivalReservationRow[]> => {
  const result = await db
    .prepare(
      `SELECT ${RESERVATION_COLUMNS}, c.nickname AS customer_nickname, c.phone AS customer_phone,` +
        ` ${HAS_NEWER_RESERVATION("res")} AS has_newer` +
        ` FROM reservations res` +
        ` JOIN customers c ON c.id = res.customer_id` +
        ` WHERE res.store_id = ?1 AND res.status NOT IN ('customer_cancelled', 'admin_cancelled')` +
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
 * 完了済みにする1文の UPDATE（設計書「確保の状態と、残りの数え方」の「完了済み」の行）。変わったら true。
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
 */
export const completeReservationIfAllowed = async (
  db: Db,
  input: { reservationId: string; storeId: string; nowIso: string; expiredGraceFromIso: string },
): Promise<boolean> => {
  const remainingOfOffer = `(SELECT ${remainingExpression("o", "?3")} FROM offers o WHERE o.id = reservations.offer_id)`;
  const result = await db
    .prepare(
      `UPDATE reservations SET` +
        ` status = 'completed',` +
        ` status_at = ?3,` +
        ` completed_after_expiry = CASE WHEN reservations.expires_at > ?3 THEN 0 ELSE 1 END,` +
        ` holds_slot = CASE WHEN reservations.expires_at > ?3 THEN 1 WHEN ${remainingOfOffer} >= 1 THEN 1 ELSE 0 END` +
        ` WHERE reservations.id = ?1 AND reservations.store_id = ?2 AND reservations.status = 'active'` +
        ` AND (reservations.expires_at > ?3` +
        ` OR (reservations.expires_at > ?4 AND NOT ${HAS_NEWER_RESERVATION("reservations")}))` +
        ` AND NOT EXISTS (SELECT 1 FROM stores s WHERE s.id = reservations.store_id AND s.status = 'banned')`,
    )
    .bind(input.reservationId, input.storeId, input.nowIso, input.expiredGraceFromIso)
    .run();
  return changedRows(result) > 0;
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
 * 店が取り消す（基準 21.1・21.4）。入ったら true。
 *
 * **前の状態（確保中で期限より前）を WHERE に全部入れた1つの UPDATE** なので、同じ確保へ
 * 完了済み・客の取り消し・店の取り消しが同時に来ても、状態が2回変わることはない（基準 20.22）。
 *
 * `holds_slot` は触らない——店が取り消した確保は枠を押さえたままで、残りも募集する組数も
 * 戻らない（基準 18.4・18.5。押さえている条件の3つ目は `sqlFragments.holdsSlotCondition`）。
 */
export const cancelReservationByStore = async (db: Db, input: { reservationId: string; storeId: string; nowIso: string }): Promise<boolean> => {
  const result = await db
    .prepare(
      // 別名を付けずに表の名前で条件を書く（`endPublishedOffersStatement` と同じ形。UPDATE の
      // 別名は SQLite の版に依るので、確実な側に寄せた）。
      `UPDATE reservations SET status = 'store_cancelled', status_at = ?3` +
        ` WHERE reservations.id = ?1 AND reservations.store_id = ?2 AND ${activeReservationCondition("reservations", "?3")}`,
    )
    .bind(input.reservationId, input.storeId, input.nowIso)
    .run();
  return changedRows(result) > 0;
};

// ---------- 運営が店を止める（タスク21・要件25の基準 25.8） ----------

/**
 * 止める時点で確保中の確保（番号と客の番号だけ）。**取り消す前に読む**——取り消したあとでは
 * 「確保中だった客」を選べないので、プッシュの相手（基準 22.2）はここで決める。
 */
export const listActiveReservationsOfStore = async (db: Db, storeId: string, nowIso: string): Promise<Array<{ id: string; customerId: string }>> => {
  const result = await db
    .prepare(`SELECT res.id, res.customer_id FROM reservations res WHERE res.store_id = ?1 AND ${activeReservationCondition("res", "?2")}`)
    .bind(storeId, nowIso)
    .all();
  return ((result.results ?? []) as Array<Record<string, unknown>>).map((row) => ({ id: row.id as string, customerId: row.customer_id as string }));
};

/**
 * その店の確保中の確保を全部「運営に取り消された」にする1つの UPDATE（基準 25.8・25.11）。
 * `db.batch` の並びに入れて、状況の書き換えとオファーの終わりと同じまとまりで流す。
 *
 * 期限切れの確保は変えない（枠をもう押さえておらず、店はまだ完了済みにできる・基準 20.7）。
 * `holds_slot` は触らないが、押さえている条件に `admin_cancelled` は無いので残りは1戻る（基準 18.6）。
 */
export const adminCancelReservationsStatement = (db: Db, storeId: string, nowIso: string) =>
  db
    .prepare(
      `UPDATE reservations SET status = 'admin_cancelled', status_at = ?2` +
        ` WHERE reservations.store_id = ?1 AND ${activeReservationCondition("reservations", "?2")}`,
    )
    .bind(storeId, nowIso);

// ---------- 書く（客の取り消しと人数の変更・タスク15） ----------

/** 確保中の確保だけを当てる WHERE（前の状態を文の中に入れる）。`?1` 確保・`?2` 客・`?3` 今。 */
const ACTIVE_RESERVATION_OF_CUSTOMER = `id = ?1 AND customer_id = ?2 AND status = 'active' AND expires_at > ?3`;

export type ReservationOperation = { reservationId: string; customerId: string; nowIso: string };

/**
 * 客が自分の確保を取り消す（要件10の基準 10.1・10.2・要件18の基準 18.2）。取り消せたら true。
 *
 * **前の状態（確保中で期限より前）を WHERE に入れた1つの UPDATE** なので、読んでから書くまでの隙に
 * 別の要求が入っても、確保中でない確保の状態を上書きすることはない（基準 10.3）。これは形だけの
 * 用心ではない——店が取り消した確保（枠を押さえたまま・基準 18.4）を客が取り消した状態で
 * 上書きすると、店に戻らないはずの残りが1つ戻る。
 *
 * `holds_slot` を0にするのは、枠を押さえていないことを列にも残すため（`holdsSlotCondition` は
 * 客が取り消した確保をそもそも数えないので、残りの計算はどちらでも同じ答えになる）。
 */
export const cancelReservationByCustomer = async (db: Db, input: ReservationOperation): Promise<boolean> => {
  const result = await db
    .prepare(`UPDATE reservations SET status = 'customer_cancelled', status_at = ?3, holds_slot = 0 WHERE ${ACTIVE_RESERVATION_OF_CUSTOMER}`)
    .bind(input.reservationId, input.customerId, input.nowIso)
    .run();
  return changedRows(result) > 0;
};

/**
 * 客が確保の人数を変える（要件10の基準 10.6・10.9）。変えられたら true。
 *
 * 変えるのは人数の列だけ——確保・コード・期限・クーポン・状態はそのまま（基準 10.6）。状態が
 * 変わらないので `status_at` も動かさず、状態の変化の記録（基準 27.4）も足さない。
 * 「何名まで」との比べ方は `domain/reservation.ts` の `canChangeParty` が持つ（1つの責務は1か所）。
 */
export const updateReservationParty = async (db: Db, input: ReservationOperation & { party: number }): Promise<boolean> => {
  const result = await db
    .prepare(`UPDATE reservations SET party = ?4 WHERE ${ACTIVE_RESERVATION_OF_CUSTOMER}`)
    .bind(input.reservationId, input.customerId, input.nowIso, input.party)
    .run();
  return changedRows(result) > 0;
};
