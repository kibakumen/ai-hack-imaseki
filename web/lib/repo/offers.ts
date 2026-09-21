// offers の表への読み書き（設計書「ファイル構成の計画」: lib/repo は D1 の SQL）。
// 「公開中」の条件と残りの式は repo/sqlFragments.ts のただ1つの置き場から組み立てる。
// 時刻の比較は、手続きが束縛した「今」を引数で受ける（SQLite の datetime('now') は使わない）。

import type { Deps } from "../ports";
import { publishingOfferCondition, remainingExpression } from "./sqlFragments";

type Db = Deps["db"];

/** 壊れた JSON は「1つも無い」として読む（表示が止まらないようにする）。 */
const parseIdList = (raw: unknown): string[] => {
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
};

const changedRows = (result: unknown): number => {
  const meta = (result as { meta?: { changes?: number } } | null)?.meta;
  return Number(meta?.changes ?? 0);
};

// ---------- 公開の前に読む店の状態（要件17の基準 17.10・17.11） ----------

export type StorePublishState = {
  id: string;
  status: "pending" | "approved" | "banned";
  name: string | null;
  address: string | null;
  genres: string[];
  budgetMin: number | null;
  budgetMax: number | null;
};

/**
 * 公開の可否を決めるのに要る店の列だけを読む。
 * ⚠️ 店の情報の保存はタスク5（repo/stores.ts）が持つ。ここは読むだけ。
 */
export const findStorePublishState = async (db: Db, storeId: string): Promise<StorePublishState | null> => {
  const row = await db
    .prepare(`SELECT id, status, name, address, genres, budget_min, budget_max FROM stores WHERE id = ?1`)
    .bind(storeId)
    .first();
  if (!row) return null;
  return {
    id: row.id as string,
    status: row.status as StorePublishState["status"],
    name: (row.name as string | null) ?? null,
    address: (row.address as string | null) ?? null,
    genres: parseIdList(row.genres),
    budgetMin: (row.budget_min as number | null) ?? null,
    budgetMax: (row.budget_max as number | null) ?? null,
  };
};

// ---------- クーポン（読むだけ） ----------

export type CouponRow = { id: string; name: string; note: string };

/**
 * その店のクーポンを作った順に読む（要件4の基準 4.8）。
 * ⚠️ クーポンの書き込みはタスク6（repo/coupons.ts）が持つ。公開のフォームと公開中のカードが
 * 名前を出すために読むだけなので、ここに読み口を置いた（AI判断・タスク6と重なったら片方へ寄せる）。
 */
export const listStoreCoupons = async (db: Db, storeId: string): Promise<CouponRow[]> => {
  const result = await db.prepare(`SELECT id, name, note FROM coupons WHERE store_id = ?1 ORDER BY created_at, rowid`).bind(storeId).all();
  return ((result.results ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    name: (row.name as string | null) ?? "",
    note: (row.note as string | null) ?? "",
  }));
};

/**
 * そのクーポンが、今公開中のオファーで見せられているか（要件16の基準 16.5）。
 * ⚠️ クーポンの編集・削除を断るのはタスク6。判断に要る「公開中」の条件と `coupon_ids` の読み方が
 * オファーの側にあるので、読み口だけをここに置いた（タスク6 は `coupon_in_use` を返すのに呼ぶ）。
 */
export const isCouponInUse = async (db: Db, storeId: string, couponId: string, nowIso: string): Promise<boolean> => {
  const row = await db
    .prepare(
      `SELECT 1 AS found FROM offers o` +
        ` WHERE o.store_id = ?1 AND ${publishingOfferCondition("o", "?3")}` +
        ` AND EXISTS (SELECT 1 FROM json_each(o.coupon_ids) WHERE json_each.value = ?2)`,
    )
    .bind(storeId, couponId, nowIso)
    .first();
  return row !== null;
};

// ---------- オファーの行 ----------

export type OfferRow = {
  id: string;
  capacity: number;
  initialCapacity: number;
  partyMax: number;
  publishedAt: string;
  untilAt: string;
  couponIds: string[];
};

export type LiveOfferRow = OfferRow & { remaining: number };

const toOfferRow = (row: Record<string, unknown>): OfferRow => ({
  id: row.id as string,
  capacity: row.capacity as number,
  initialCapacity: row.initial_capacity as number,
  partyMax: row.party_max as number,
  publishedAt: row.published_at as string,
  untilAt: row.until_at as string,
  couponIds: parseIdList(row.coupon_ids),
});

const OFFER_COLUMNS = `o.id, o.capacity, o.initial_capacity, o.party_max, o.published_at, o.until_at, o.coupon_ids`;

/** 今そのお店が公開中のオファー（残りつき）。無ければ null（要件17の基準 17.13・17.14）。 */
export const findLiveOffer = async (db: Db, storeId: string, nowIso: string): Promise<LiveOfferRow | null> => {
  const row = await db
    .prepare(
      `SELECT ${OFFER_COLUMNS}, ${remainingExpression("o", "?2")} AS remaining FROM offers o` +
        ` WHERE o.store_id = ?1 AND ${publishingOfferCondition("o", "?2")}` +
        ` ORDER BY o.published_at DESC, o.rowid DESC LIMIT 1`,
    )
    .bind(storeId, nowIso)
    .first();
  return row ? { ...toOfferRow(row as Record<string, unknown>), remaining: (row as { remaining: number }).remaining } : null;
};

/** いちばん新しいオファー（終わっているかどうかは見ない）。公開のフォームの初めの値に使う（基準 17.17）。 */
export const findLastOffer = async (db: Db, storeId: string): Promise<OfferRow | null> => {
  const row = await db
    .prepare(`SELECT ${OFFER_COLUMNS} FROM offers o WHERE o.store_id = ?1 ORDER BY o.published_at DESC, o.rowid DESC LIMIT 1`)
    .bind(storeId)
    .first();
  return row ? toOfferRow(row as Record<string, unknown>) : null;
};

// ---------- 公開と停止 ----------

export type NewOffer = {
  id: string;
  storeId: string;
  capacity: number;
  partyMax: number;
  publishedAtIso: string;
  untilAtIso: string;
  couponIds: string[];
};

/**
 * 公開中のオファーが無いときだけ1件入れる（要件17の基準 17.9）。入ったら true。
 * 「その店に公開中が無い」と「店が承認済み」を **1つの文の WHERE** に入れるので、
 * 読んでから書くまでの隙に別の要求が入っても、公開中が2つになることはない（設計書「オファーの状態」）。
 * 公開した時の残りは募集する組数と同じ（要件18の基準 18.10。確保がまだ無いので式がそのまま同じ数を出す）。
 */
export const insertOfferIfNone = async (db: Db, offer: NewOffer): Promise<boolean> => {
  const result = await db
    .prepare(
      `INSERT INTO offers (id, store_id, capacity, initial_capacity, party_max, published_at, until_at, coupon_ids)` +
        ` SELECT ?1, ?2, ?3, ?3, ?4, ?5, ?6, ?7` +
        ` WHERE EXISTS (SELECT 1 FROM stores s WHERE s.id = ?2 AND s.status = 'approved')` +
        ` AND NOT EXISTS (SELECT 1 FROM offers o WHERE o.store_id = ?2 AND ${publishingOfferCondition("o", "?5")})`,
    )
    .bind(offer.id, offer.storeId, offer.capacity, offer.partyMax, offer.publishedAtIso, offer.untilAtIso, JSON.stringify(offer.couponIds))
    .run();
  return changedRows(result) > 0;
};

/**
 * 公開中のオファーを終わりにする（要件17の基準 17.12・17.13）。終わらせたら true。
 * 確保には触れない（基準 17.16）。
 */
export const stopLiveOffer = async (db: Db, storeId: string, nowIso: string): Promise<boolean> => {
  const result = await db
    .prepare(`UPDATE offers SET ended_at = ?2, end_reason = 'stopped' WHERE store_id = ?1 AND ${publishingOfferCondition("offers", "?2")}`)
    .bind(storeId, nowIso)
    .run();
  return changedRows(result) > 0;
};

// ---------- 公開中の変更（要件19・タスク20が足した） ----------

/**
 * その店の公開中のオファーだけを当てる WHERE（`?1` 店・`?2` 今）。
 *
 * 終わったオファーへの変更を受け付けない（基準 19.12）のは、この条件が1つの UPDATE の中に
 * 入っているから——読んでから書くまでの隙に「何時まで」を過ぎても、変更は当たらない。
 */
const LIVE_OFFER_OF_STORE = `store_id = ?1 AND ${publishingOfferCondition("offers", "?2")}`;

export type OfferChange = { storeId: string; nowIso: string };

/**
 * 「追加で出す」——募集する組数を増やす（要件19の基準 19.1・19.3）。増やせたら true。
 *
 * **足したあとの残りが上限を超えないこと**（基準 19.2）を同じ文の WHERE に入れる。読んでから
 * 書くまでの隙に別の客が受け取っても、上限を超えて出すことはない。残りが0でも足せる（基準 19.3
 * ——上限は「足したあとの残り」に掛かっており、今の残りには掛からない）。
 * `initial_capacity` は動かさない（公開のとき入れた値・基準 17.17）。
 */
export const addLiveOfferCapacity = async (db: Db, input: OfferChange & { count: number; remainingMax: number }): Promise<boolean> => {
  const result = await db
    .prepare(`UPDATE offers SET capacity = capacity + ?3 WHERE ${LIVE_OFFER_OF_STORE} AND ${remainingExpression("offers", "?2")} + ?3 <= ?4`)
    .bind(input.storeId, input.nowIso, input.count, input.remainingMax)
    .run();
  return changedRows(result) > 0;
};

/**
 * 「残りの募集を減らす」——募集する組数を減らす（要件19の基準 19.4）。減らせたら true。
 *
 * **残り以下であること**（基準 19.5）を同じ文の WHERE に入れる。これは形だけの用心ではない——
 * 受け取りと減らすが同時に来たとき、読んでから書く形だと残りが0を下回る（要件18の基準 18.11）。
 */
export const reduceLiveOfferCapacity = async (db: Db, input: OfferChange & { count: number }): Promise<boolean> => {
  const result = await db
    .prepare(`UPDATE offers SET capacity = capacity - ?3 WHERE ${LIVE_OFFER_OF_STORE} AND ${remainingExpression("offers", "?2")} >= ?3`)
    .bind(input.storeId, input.nowIso, input.count)
    .run();
  return changedRows(result) > 0;
};

/**
 * 「何名まで」を変える（要件19の基準 19.6）。変えられたら true。
 * それ以後の絞り込みと受け取りは、どちらもこの列を見ているので、自動的に変えたあとの値と
 * 比べることになる（基準 19.7）。確保には触れない（基準 19.10）。
 */
export const updateLiveOfferPartyMax = async (db: Db, input: OfferChange & { partyMax: number }): Promise<boolean> => {
  const result = await db.prepare(`UPDATE offers SET party_max = ?3 WHERE ${LIVE_OFFER_OF_STORE}`).bind(input.storeId, input.nowIso, input.partyMax).run();
  return changedRows(result) > 0;
};

/**
 * 「何時まで」を変える（要件19の基準 19.8）。変えられたら true。
 * 延ばすことも早めることもできる。時分を時点へ直す判断は `domain/until.ts` が済ませてある。
 */
export const updateLiveOfferUntil = async (db: Db, input: OfferChange & { untilAtIso: string }): Promise<boolean> => {
  const result = await db.prepare(`UPDATE offers SET until_at = ?3 WHERE ${LIVE_OFFER_OF_STORE}`).bind(input.storeId, input.nowIso, input.untilAtIso).run();
  return changedRows(result) > 0;
};
