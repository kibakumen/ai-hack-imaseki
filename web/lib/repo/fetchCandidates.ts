// 取得のときに読む「受け取れる状態のオファーを持つ店」と、その店のクーポン（設計書「ファイル構成の計画」:
// lib/repo は D1 の SQL）。絞り込み（距離・人数・予算）は domain/filter が決めるので、ここは
// 受け取れる状態（repo/sqlFragments）と、位置が入っていることだけで引く。
//
// 時刻の比較は、呼ぶ側が束縛した「今」で行う（SQLite の datetime('now') は使わない・実行者への契約）。

import type { Deps } from "../ports";
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

/** 壊れた JSON は「空」として読む（取得が止まらないようにする。repo/customers と同じ扱い）。 */
const parseStrings = (raw: unknown): string[] => {
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
};

const CANDIDATES_SQL = `
  SELECT o.id AS offer_id, o.party_max, o.coupon_ids,
         s.id AS store_id, s.name AS store_name, s.url AS store_url,
         s.lat, s.lng, s.genres, s.menus, s.budget_min, s.budget_max, s.created_at
  FROM offers o
  JOIN stores s ON s.id = o.store_id
  WHERE s.status = 'approved'
    AND s.lat IS NOT NULL AND s.lng IS NOT NULL
    AND ${receivableCondition("o", "?1")}
  ORDER BY s.id
`;

/**
 * 受け取れる状態のオファーを持つ、承認済みの店（基準 5.2）。
 *
 * 店の状態も見る（止められている店の行を客へ出さない）。運営が店を止めるとオファーも終わる
 * （設計書「オファーの状態」）ので、この条件は受け取れる状態の判断を二重に持つものではない。
 */
export const findFetchCandidates = async (db: Db, nowIso: string): Promise<CandidateRow[]> => {
  const result = await db.prepare(CANDIDATES_SQL).bind(nowIso).all();
  const rows = (result.results ?? []) as Record<string, unknown>[];
  return rows.map((row) => ({
    offerId: row.offer_id as string,
    partyMax: Number(row.party_max ?? 0),
    couponIds: parseStrings(row.coupon_ids),
    storeId: row.store_id as string,
    storeName: (row.store_name as string | null) ?? "",
    storeUrl: (row.store_url as string | null) ?? null,
    lat: Number(row.lat),
    lng: Number(row.lng),
    genres: parseStrings(row.genres),
    menus: parseStrings(row.menus),
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
