// reservations の表への読み書きのうち、客の確保そのもの（設計書「ファイル構成の計画」: lib/repo は D1 の SQL）。
// 確保1行の形と列（`RESERVATION_COLUMNS`・`toReservationRow`）、客のホーム／受け取り直しが読む確保と店とオファーの今、
// 客の取り消しと人数の変更。「公開中」「枠を押さえている確保」「残り」の条件は repo/sqlFragments.ts のただ1つの置き場から組む。
// 時刻の比較は、手続きが束縛した「今」を引数で受ける（SQLite の datetime('now') は使わない）。
//
// ⚠️ 確保の表の別名は **`res`** で固定する（`r` は使わない）——`remainingExpression` の中の
//    副問い合わせが `reservations r` を使うので、外側でも `r` を使うと読む人が取り違える。
//
// 2026-09-25 監査の指摘 設計-16 で3つに分けた（6つのタスクが順に継ぎ足して 569 行になっていた）。SQL は変えていない:
//   repo/reservations.ts         … ここ（確保の形・客の確保の読み・客の取り消しと人数の変更）
//   repo/reservationReceive.ts   … 受け取り（受け取りの1文の INSERT と、その判断に要る読み）
//   repo/reservationsOfStore.ts  … 店の側（向かっている客の一覧・完了済み・店の取り消し・運営の取り消し）
// 状態を変える操作は、どれも **1つの UPDATE（前の状態を WHERE に入れる）** で書く。列の名前は写さず、
// `RESERVATION_COLUMNS` と `toReservationRow` を使い回す。

import type { ReservationStateRow } from "../domain/reservation";
import type { Deps } from "../ports";
import { changedRows, parseJsonArray } from "./d1";
import { reservationEventStatement } from "./logs";
import { activeReservationCondition, remainingExpression } from "./sqlFragments";

type Db = Deps["db"];

/** 壊れた JSON は「1つも無い」として読む（画面が止まらないようにする）。 */
export const parseCoupons = (raw: unknown): Array<{ name: string; note: string }> =>
  parseJsonArray(raw).flatMap((value) => {
    if (typeof value !== "object" || value === null) return [];
    const coupon = value as { name?: unknown; note?: unknown };
    return [{ name: typeof coupon.name === "string" ? coupon.name : "", note: typeof coupon.note === "string" ? coupon.note : "" }];
  });

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

/**
 * その確保を選んだ取得の起点。客の画面が「Googleマップで経路を開く」の出発地に使う（2026-09-22 の本人の指摘・3回目——
 * 画面の状態や `sessionStorage` に頼ると、タブが変わる・読み直す・保存を止めた端末で出発地が現在地へ戻る）。
 *
 * **客が打った場所の文字と、ジオコーディングの応答の place ID**（`fetch_logs.origin_place`・`origin_place_id`）で返す
 * （2026-09-26 本人選択）。Google で直した座標は Service Specific Terms 6.3.1 で連続30日までしか置けないので、
 * 記録にはもう書かない（migrations/0016 で既にある行からも消した）。Maps URLs は出発地を文字でも place ID
 * （`origin_place_id`）でも受ける（lib/client/lastOrigin の routeHref）。
 *
 * **現在地で探した取得なら null**（`fetch_logs.origin_kind = 'here'`・2026-09-25 監査の指摘 客-11）——探した時点の
 * 座標を固定の出発地にすると、歩き出した客の経路が探した場所から引かれる。付けなければマップが今の現在地から引く。
 * 打った文字の無い古い行（migrations/0016 より前の行）と、記録が読めないとき（外部の鍵で必ず在るはずだが、無いことを
 * 理由に確保を描けなくしない）も null。
 */
export type ReservationOrigin = { place: string; placeId?: string } | null;

export type ReservationContext = { reservation: ReservationRow; store: ReservationStore; offer: ReservationOffer; origin: ReservationOrigin };

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
  ` o.ended_at, o.until_at, o.party_max, ${remainingExpression("o", "?2")} AS remaining,` +
  ` f.origin_kind, f.origin_place, f.origin_place_id` +
  ` FROM reservations res` +
  ` JOIN stores s ON s.id = res.store_id` +
  ` JOIN offers o ON o.id = res.offer_id` +
  // 記録の表は読むだけ（追加以外の文は置かない・基準 27.7）。LEFT JOIN＝記録が無くても確保は描く
  ` LEFT JOIN fetch_logs f ON f.id = res.fetch_id` +
  ` WHERE ${where}` +
  ` ORDER BY res.created_at DESC, res.rowid DESC LIMIT 1`;

/** 記録の行から経路の出発地を組む（打った場所で探して、文字が残っているときだけ）。 */
const toOrigin = (row: Record<string, unknown>): ReservationOrigin => {
  if (row.origin_kind !== "place" || typeof row.origin_place !== "string" || row.origin_place === "") return null;
  return typeof row.origin_place_id === "string" && row.origin_place_id !== "" ? { place: row.origin_place, placeId: row.origin_place_id } : { place: row.origin_place };
};

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
  origin: toOrigin(row),
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

/** その客が確保中の確保を持っているか（基準 8.8。期限切れは数えない・基準 8.9）。 */
export const hasActiveReservation = async (db: Db, customerId: string, nowIso: string): Promise<boolean> => {
  const row = await db
    .prepare(`SELECT 1 AS found FROM reservations res WHERE res.customer_id = ?1 AND ${activeReservationCondition("res", "?2")} LIMIT 1`)
    .bind(customerId, nowIso)
    .first();
  return row !== null;
};

/**
 * その客の確保を、状態を導くのに要る2つの列だけで全部返す（タスク32 が足した）。
 * 登録を消せるかの判断（`domain/customer.canDeleteRegistration`・基準 28.5）が、期限切れの猶予
 * まで見るので、`hasActiveReservation` の真偽ひとつでは足りない。
 */
export const listReservationStatesOfCustomer = async (db: Db, customerId: string): Promise<ReservationStateRow[]> => {
  const result = await db.prepare(`SELECT res.status, res.expires_at FROM reservations res WHERE res.customer_id = ?1`).bind(customerId).all();
  return ((result.results ?? []) as Array<Record<string, unknown>>).map((row) => ({
    status: row.status as string,
    expiresAt: new Date(row.expires_at as string),
  }));
};

// ---------- 書く（客の取り消しと人数の変更・タスク15） ----------

/** 確保中の確保だけを当てる WHERE（前の状態を文の中に入れる）。`?1` 確保・`?2` 客・`?3` 今。 */
const ACTIVE_RESERVATION_OF_CUSTOMER = `reservations.id = ?1 AND reservations.customer_id = ?2 AND ${activeReservationCondition("reservations", "?3")}`;

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
 * 状態の変化の記録（基準 27.4）も同じ `db.batch` の並びで書く（不具合-16）。
 */
export const cancelReservationByCustomer = async (db: Db, input: ReservationOperation): Promise<boolean> => {
  const update = db
    .prepare(`UPDATE reservations SET status = 'customer_cancelled', status_at = ?3, holds_slot = 0 WHERE ${ACTIVE_RESERVATION_OF_CUSTOMER}`)
    .bind(input.reservationId, input.customerId, input.nowIso);
  // 状態の変化の記録（基準 27.4）は同じまとまりで書く（不具合-16）
  const [updated] = await db.batch([update, reservationEventStatement(db, { reservationId: input.reservationId, status: "customer_cancelled", at: input.nowIso })]);
  return changedRows(updated) > 0;
};

/**
 * 客が確保の人数を変える（要件10の基準 10.6・10.7・10.9）。変えられたら true。
 *
 * 変えるのは人数の列だけ——確保・コード・期限・クーポン・状態はそのまま（基準 10.6）。状態が
 * 変わらないので `status_at` も動かさず、状態の変化の記録（基準 27.4）も足さない。
 *
 * 「何名まで」との比べ方の正本は `domain/reservation.ts` の `canChangeParty` で、WHERE の最後の条件は
 * その SQL 版（減らす・同じなら通す／増やすなら**この文が走る時点の**「何名まで」以下）——**どちらかを
 * 直したら両方直す**。手続きが読んで確かめたあとに店が「何名まで」を下げても、上限を超えた人数を
 * 書かない（不具合-13）。
 */
export const updateReservationParty = async (db: Db, input: ReservationOperation & { party: number }): Promise<boolean> => {
  const result = await db
    .prepare(
      `UPDATE reservations SET party = ?4 WHERE ${ACTIVE_RESERVATION_OF_CUSTOMER}` +
        ` AND (?4 <= reservations.party OR ?4 <= (SELECT o.party_max FROM offers o WHERE o.id = reservations.offer_id))`,
    )
    .bind(input.reservationId, input.customerId, input.nowIso, input.party)
    .run();
  return changedRows(result) > 0;
};
