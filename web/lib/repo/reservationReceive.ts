// reservations の表への読み書きのうち、受け取り（要件8・11 の受け取り直し）。2026-09-25 監査の指摘 設計-16 で
// repo/reservations.ts から分けた（SQL は変えていない）。受け取りは1文の INSERT（条件を全部 WHERE に入れる）で、
// 通らなかった理由の判断に要る読み（オファーの今・コードの重なり・取得の記録）もここに置く。
// 確保1行の形と列は repo/reservations.ts が持つ。

import type { Deps } from "../ports";
import { changedRows } from "./d1";
import { reservationEventStatement, selectionStatement } from "./logs";
import { activeReservationCondition, expiredWithinGraceCondition, publishingOfferCondition, remainingExpression } from "./sqlFragments";
import { type ReservationOffer } from "./reservations";

type Db = Deps["db"];

/** 断りの理由の読み直しに使う、オファーの今と店の状況。オファーが無ければ null。 */
export const findOfferForReceive = async (db: Db, offerId: string, nowIso: string): Promise<{ offer: ReservationOffer; storeBanned: boolean } | null> => {
  const row = await db
    .prepare(
      `SELECT o.ended_at, o.until_at, o.party_max, ${remainingExpression("o", "?2")} AS remaining, s.status AS store_status, s.withdrawn_at AS store_withdrawn_at` +
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
    // 退会した店（2026-09-26）は状況が banned でも「運営に取り消された」とは言わない。オファーは退会と同時に終わっているので、
    // 断りの理由は「受け付けは終わりました」に倒れる
    storeBanned: r.store_status === "banned" && (r.store_withdrawn_at === null || r.store_withdrawn_at === undefined),
  };
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
 * その客の取得の記録の時刻。在らない・別の客のものなら null（受け取りの `fetchId` の確かめ）。
 *
 * `reservations.fetch_id` は取得の記録を指すが、**外部の鍵の制約は無い**（`migrations/0001_init.sql` の
 * reservations に FOREIGN KEY (fetch_id) は無い。2026-09-25 の監査の直しで、在ると書いていた誤りを直した・設計-12）。
 * 在らない番号・別の客の番号の受け取りは、INSERT の WHERE（その取得の結果にその店が出たか）が0行にするだけで
 * 落ちはしないが、断りの理由を場合分けできるよう、INSERT の前に入力の断りへ倒すために見る（要件29）。
 * 取得から一定時間を過ぎた結果からは新しく受け取らせない（安全-06）ので、時刻まで返す。
 */
export const findFetchLogAt = async (db: Db, fetchId: string, customerId: string): Promise<Date | null> => {
  const row = await db.prepare(`SELECT at FROM fetch_logs WHERE id = ?1 AND customer_id = ?2 LIMIT 1`).bind(fetchId, customerId).first();
  const at = (row as { at?: unknown } | null)?.at;
  return typeof at === "string" ? new Date(at) : null;
};

/**
 * その取得の結果に、そのオファーの店が出たか（結果に無い店の受け取りの件（不具合-12）・安全-06 の案B）。
 * 取得の記録 `fetch_items` はどのオファーだったかを持たないので、店で突き合わせる。記録は追加だけの表なので、
 * ここで見てから INSERT するまでの間に答えが変わることはない（INSERT の WHERE にも同じ条件を入れてある）。
 */
export const fetchShowsOffer = async (db: Db, input: { fetchId: string; offerId: string }): Promise<boolean> => {
  const row = await db
    .prepare(`SELECT 1 AS found FROM fetch_items fi JOIN offers o ON o.store_id = fi.store_id WHERE fi.fetch_id = ?1 AND o.id = ?2 LIMIT 1`)
    .bind(input.fetchId, input.offerId)
    .first();
  return row !== null;
};

/**
 * その客が、そのオファーを押さえた件数（受け取りと受け取り直しを合わせて・取得をまたいで・状態を問わない）。
 * 押さえられる件数の上限（安全-06 の案A と案C）の判断と、期限切れの表示で受け取り直しを勧めるかに使う。
 */
export const countReceivesOfOffer = async (db: Db, input: { customerId: string; offerId: string }): Promise<number> => {
  const row = await db.prepare(`SELECT COUNT(*) AS n FROM reservations WHERE customer_id = ?1 AND offer_id = ?2`).bind(input.customerId, input.offerId).first();
  return Number((row as { n?: unknown } | null)?.n ?? 0);
};

export const findLastFetchAt = async (db: Db, customerId: string): Promise<Date | null> => {
  const row = await db.prepare(`SELECT MAX(at) AS last_at FROM fetch_logs WHERE customer_id = ?1`).bind(customerId).first();
  const value = (row as { last_at?: unknown } | null)?.last_at;
  return typeof value === "string" && value !== "" ? new Date(value) : null;
};

// ---------- 書く（受け取り・受け取り直し） ----------

/**
 * 確保に写すクーポン（`receiveReservation` の INSERT の中の式・?3＝取得の番号・?8＝受け取った時点の写し・?11＝受け取り直しの元の確保）。
 * 受け取り直しなら元の確保の写し、受け取りならその取得の結果で見せた写し（同じオファーのもの）。どちらも無ければ受け取った時点の写し。
 */
const SEEN_COUPONS =
  `CASE WHEN ?11 IS NOT NULL THEN COALESCE((SELECT prev.coupons_json FROM reservations prev WHERE prev.id = ?11), ?8)` +
  ` ELSE COALESCE((SELECT fi.coupons_json FROM fetch_items fi WHERE fi.fetch_id = ?3 AND fi.offer_id = o.id AND fi.coupons_json IS NOT NULL LIMIT 1), ?8) END`;

export type NewReservation = {
  id: string;
  offerId: string;
  customerId: string;
  fetchId: string;
  party: number;
  code: string;
  nowIso: string;
  expiresAtIso: string;
  /**
   * 受け取った時点のクーポンの写し（JSON の文字列）。**写しの無いときの控え**——受け取りは取得の記録の写し（客が見たクーポン）、
   * 受け取り直しは元の確保の写しを先に使う（`receiveReservation` の注）
   */
  couponsJson: string;
  /** 同じ客が同じオファーを押さえられる件数（取得をまたいで・安全-06。値の正本は schemas/limits の RECEIVES_PER_OFFER_MAX） */
  receivesPerOfferMax: number;
  /**
   * 受け取り直しなら元の確保の番号（基準 11.10）。受け取りなら null。
   * 元の確保が**この文が走る時点でも**「期限切れで、期限から20分以内」のままであることを条件に入れる（不具合-14）。
   */
  retryOf: string | null;
  /** 「今 − 20分」（受け取り直しの条件の境目。引き算は手続きが済ませる） */
  expiredGraceFromIso: string;
  /** 選択の記録（基準 27.3）の番号 */
  selectionId: string;
};

/**
 * 受け取りの1文の INSERT（設計書「確保の状態と、残りの数え方」の「受け取り」の行）と、その記録。入ったら true。
 *
 * 条件を**1つの文の WHERE に全部入れる**ので、読んでから書くまでの隙に別の要求が入っても、
 * 残りを超えて確保が作られることはない（基準 8.7・18.11）:
 *   ①そのオファーが受け取れる状態（店が承認済み・公開中・残りが1以上）
 *   ②人数がその時点の「何名まで」以下（基準 8.6。取得のあとに店が下げていることがある）
 *   ③その客に確保中の確保が無い（基準 8.8。期限切れ・完了済み・取り消された確保は数えない・8.9）
 *   ④その客がそのオファーを押さえた件数が、取得をまたいで上限未満（受け取り直しは1回まで・安全-06 の案A と案C）
 *   ⑤その取得の結果に、そのオファーの店が出ている（結果に無い店の受け取りの件（不具合-12）・安全-06 の案B）
 *   ⑥その客の登録が消えていない（登録の消去と受け取りが同時に来たとき、名無しの確保を作らない・不具合-15）
 *   ⑦受け取り直しなら、元の確保がまだ「期限切れで、期限から20分以内」のまま（店の完了済みと同時に来たとき、
 *     1組が2枠を押さえない・不具合-14。完了済みが先に入っていれば元の確保はもう `active` でない）
 * 距離と予算は見ない（基準 8.6 の補足——結果に出た時点で通っており、歩いた客を断る理由が無い）。
 *
 * 店の状況も見る（止められている店から受け取らせない）。運営が店を止めるとオファーも終わるので、
 * これは受け取れる状態の判断を二重に持つものではない（設計書「オファーの状態」）。
 *
 * クーポンは**客が見たもの**を写す（要件16の基準 16.6・2026-09-26 本人発案（受諾した時点のクーポンを保障））:
 *   - 受け取り … その取得の結果で見せたクーポン（`fetch_items.coupons_json`・migration 0017）。店が結果のあとに選び直していても、
 *     見せたものが入る。同じ1文の中で記録の表（追加だけ）から読むので、受け取りと店の選び直しが同時に来ても変わらない
 *   - 受け取り直し（結果を経ない・基準 11.10）… 元の確保のクーポンを引き継ぐ（客が受諾したときに見たものは、元の確保が持っている・AI判断）
 *   - どちらの写しも無い（0017 より前の記録・見せたオファーと違うオファーの番号）… 今までどおり受け取った時点のクーポン（`couponsJson`）
 *
 * 客の電話番号は**受け取った時点の値を確保の行に写す**（`customer_phone`・安全-17 の案1）。店の一覧はこの写しを
 * 読むので、あとから客が番号を入れ直しても、前に受け取った店へは渡らない。仮の番号かどうかは写したあとで
 * `domain/storeHome` が見る（判断を SQL に置かない）。
 *
 * 選択の記録（基準 27.3）と状態の変化の記録（基準 27.4）は**同じ `db.batch` の並び**で書く（不具合-16）——
 * どちらの文も確保の行が在るときだけ足すので、確保を作らなかったまとまりでは何も残らない。
 */
export const receiveReservation = async (db: Db, input: NewReservation): Promise<boolean> => {
  const insert = db
    .prepare(
      `INSERT INTO reservations (id, offer_id, store_id, customer_id, fetch_id, party, code, created_at, expires_at, status, status_at, holds_slot, completed_after_expiry, coupons_json, customer_phone)` +
        ` SELECT ?1, o.id, o.store_id, ?2, ?3, ?4, ?5, ?6, ?7, 'active', ?6, 1, 0, ${SEEN_COUPONS}, c.phone` +
        ` FROM offers o JOIN stores s ON s.id = o.store_id JOIN customers c ON c.id = ?2` +
        ` WHERE o.id = ?9` +
        ` AND s.status = 'approved'` +
        ` AND c.deleted_at IS NULL` +
        ` AND ${publishingOfferCondition("o", "?6")}` +
        ` AND ${remainingExpression("o", "?6")} >= 1` +
        ` AND ?4 <= o.party_max` +
        ` AND NOT EXISTS (SELECT 1 FROM reservations ar WHERE ar.customer_id = ?2 AND ${activeReservationCondition("ar", "?6")})` +
        ` AND (SELECT COUNT(*) FROM reservations pr WHERE pr.customer_id = ?2 AND pr.offer_id = ?9) < ?10` +
        ` AND EXISTS (SELECT 1 FROM fetch_items fi WHERE fi.fetch_id = ?3 AND fi.store_id = o.store_id)` +
        ` AND (?11 IS NULL OR EXISTS (SELECT 1 FROM reservations prev WHERE prev.id = ?11 AND prev.customer_id = ?2 AND ${expiredWithinGraceCondition("prev", "?6", "?12")}))`,
    )
    .bind(
      input.id,
      input.customerId,
      input.fetchId,
      input.party,
      input.code,
      input.nowIso,
      input.expiresAtIso,
      input.couponsJson,
      input.offerId,
      input.receivesPerOfferMax,
      input.retryOf,
      input.expiredGraceFromIso,
    );
  const [inserted] = await db.batch([
    insert,
    selectionStatement(db, { id: input.selectionId, reservationId: input.id, at: input.nowIso }),
    reservationEventStatement(db, { reservationId: input.id, status: "active", at: input.nowIso }),
  ]);
  return changedRows(inserted) > 0;
};
