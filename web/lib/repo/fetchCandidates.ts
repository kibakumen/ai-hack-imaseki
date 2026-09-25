// 取得のときに読む「受け取れる状態のオファーを持つ店」と、その店のクーポン（設計書「ファイル構成の計画」:
// lib/repo は D1 の SQL）。絞り込み（距離・人数・予算）は domain/filter が決めるので、ここは
// 受け取れる状態（repo/sqlFragments）と、位置が入っていることだけで引く。
//
// 時刻の比較は、呼ぶ側が束縛した「今」で行う（SQLite の datetime('now') は使わない・実行者への契約）。

import type { GeoBounds } from "../domain/geo";
import type { Deps } from "../ports";
import { parseStringList } from "./d1";
import { receivableCondition } from "./sqlFragments";

type Db = Deps["db"];

/** 候補になりうる1行（店とその公開中のオファー）。 */
export type CandidateRow = {
  offerId: string;
  partyMax: number;
  /** そのオファーが見せているクーポンの番号（店が公開のときに選んだもの） */
  couponIds: string[];
  storeId: string;
  storeName: string;
  storeUrl: string | null;
  /** 店の住所（客のカードに1行で出す・2026-09-25 監査の指摘 客-12）。入っていなければ null */
  storeAddress: string | null;
  lat: number;
  lng: number;
  genres: string[];
  menus: string[];
  budgetMin: number;
  budgetMax: number;
  /** 店の登録の時刻（同点・同距離のときの並びに使う・基準 4.12）。入っていなければ空 */
  createdAt: string;
};

export type CouponRow = { id: string; storeId: string; name: string; note: string };

const CANDIDATES_SQL = `
  SELECT o.id AS offer_id, o.party_max, o.coupon_ids,
         s.id AS store_id, s.name AS store_name, s.url AS store_url, s.address AS store_address,
         s.lat, s.lng, s.genres, s.menus, s.budget_min, s.budget_max, s.created_at
  FROM stores s
  CROSS JOIN offers o ON o.store_id = s.id
  WHERE s.status = 'approved'
    AND s.lat BETWEEN ?2 AND ?3 AND s.lng BETWEEN ?4 AND ?5
    AND ${receivableCondition("o", "?1")}
  ORDER BY s.id
`;

/**
 * 受け取れる状態のオファーを持つ、承認済みの店（基準 5.2）のうち、起点の周りの四角形（`domain/geo.searchBounds`）
 * に入る店。四角形は探す範囲の円を必ず含むので、範囲の内かは `domain/filter` がこれまでどおり決める
 * （2026-09-25 監査の指摘 設計-08: 全国の受け取れるオファーを読んでから 800m 以内に絞っていた）。
 * 位置の入っていない店は四角形に入らない（BETWEEN は NULL に当たらない）。
 *
 * **店から入る順を `CROSS JOIN` で固定している**（SQLite は CROSS JOIN の左右を入れ替えない）。
 * 店の緯度経度の索引（`idx_stores_lat_lng`・migration 0004）で四角形の内の店を引き、その店の公開中の
 * オファーだけを部分索引（`idx_offers_open_by_store`）で引く。普通の JOIN のままだと、計画は公開中の
 * オファーから入り、全国の公開中のオファーとその確保（残りの数の副問い合わせ）を読んでから四角形に当たる
 * （2026-09-25 のレビューの指摘。`tests/readsAndIndexes.test.ts` が計画の先頭を見張る）。
 *
 * 店の状態も見る（止められている店の行を客へ出さない）。運営が店を止めるとオファーも終わる
 * （設計書「オファーの状態」）ので、この条件は受け取れる状態の判断を二重に持つものではない。
 */
export const findFetchCandidates = async (db: Db, nowIso: string, bounds: GeoBounds): Promise<CandidateRow[]> => {
  const result = await db.prepare(CANDIDATES_SQL).bind(nowIso, bounds.latMin, bounds.latMax, bounds.lngMin, bounds.lngMax).all();
  const rows = (result.results ?? []) as Record<string, unknown>[];
  return rows.map((row) => ({
    offerId: row.offer_id as string,
    partyMax: Number(row.party_max ?? 0),
    couponIds: parseStringList(row.coupon_ids),
    storeId: row.store_id as string,
    storeName: (row.store_name as string | null) ?? "",
    storeUrl: (row.store_url as string | null) ?? null,
    storeAddress: typeof row.store_address === "string" && row.store_address !== "" ? row.store_address : null,
    lat: Number(row.lat),
    lng: Number(row.lng),
    genres: parseStringList(row.genres),
    menus: parseStringList(row.menus),
    budgetMin: Number(row.budget_min ?? 0),
    budgetMax: Number(row.budget_max ?? 0),
    createdAt: (row.created_at as string | null) ?? "",
  }));
};

/**
 * 渡した店のクーポンを、店がクーポンを作った順に返す（基準 4.8）。
 * 同じ時刻に作られた2つの順が入れ替わらないよう、入れた順（rowid）を後ろの鍵にする。
 */
export const findCouponsForStores = async (db: Db, storeIds: readonly string[]): Promise<CouponRow[]> => {
  if (storeIds.length === 0) return [];
  const placeholders = storeIds.map((_, i) => `?${i + 1}`).join(", ");
  const result = await db
    .prepare(`SELECT id, store_id, name, note FROM coupons WHERE store_id IN (${placeholders}) ORDER BY created_at, rowid`)
    .bind(...storeIds)
    .all();
  const rows = (result.results ?? []) as Record<string, unknown>[];
  return rows.map((row) => ({
    id: row.id as string,
    storeId: row.store_id as string,
    name: (row.name as string | null) ?? "",
    note: (row.note as string | null) ?? "",
  }));
};
