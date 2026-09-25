// Google の地図サービスから来た座標の手入れ（2026-09-25 監査の指摘 設計-20 の案1・migration 0009）。
// 利用条件は、Geocoding で得た緯度と経度を連続30日までしか手元に置けないとしている。ここは読み書きの文だけを持ち、
// いつ・何日で、は手続き（usecases/googleUpkeep）が決める。
//
// ⚠️ 記録の表（fetch_logs）へ UPDATE を書くのは、リポジトリでこのファイルの `coarsenOldPlaceOrigins` だけ
// （基準 27.7 の「追加だけ」の例外。書き換えるのは起点の座標の2列を粗くすることだけで、行は消さない・
// 構造の検査 structure.test.ts の 27.7 の項がこのファイルのこの1文だけを通す）。

import type { Deps } from "../ports";

type Db = Deps["db"];

/** 取り直す店1件（住所で Google に聞き直す）。 */
export type StoreToRegeocode = { id: string; address: string; geocodedAt: string };

/**
 * `sinceIso` より前に Google で位置に直した店を、古い順に `limit` 件まで。
 * 取った時刻の無い店（手で置いた座標・0009 より前の座標）は選ばない——Google の中身か分からないものを
 * Google の答えで上書きしない。
 */
export const findStoresToRegeocode = async (db: Db, sinceIso: string, limit: number): Promise<StoreToRegeocode[]> => {
  const result = await db
    .prepare(
      `SELECT id, address, geocoded_at FROM stores
       WHERE geocoded_at IS NOT NULL AND geocoded_at < ?1 AND address IS NOT NULL AND address <> '' AND lat IS NOT NULL
       ORDER BY geocoded_at ASC LIMIT ?2`,
    )
    .bind(sinceIso, limit)
    .all();
  return result.results.map((row) => ({ id: String(row.id), address: String(row.address), geocodedAt: String(row.geocoded_at) }));
};

/** 取り直した座標で書き換える。住所がその間に変わっていたら何もしない（新しい住所の保存が先に位置を直している）。 */
export const refreshStoreCoordinates = async (db: Db, store: { id: string; address: string; lat: number; lng: number; geocodedAt: string }): Promise<void> => {
  await db
    .prepare(`UPDATE stores SET lat = ?3, lng = ?4, geocoded_at = ?5 WHERE id = ?1 AND address = ?2`)
    .bind(store.id, store.address, store.lat, store.lng, store.geocodedAt)
    .run();
};

/**
 * 取り直せないまま期限を過ぎた座標を消す（店は住所を保存し直すまで探す結果に出ない）。
 * 読んだときと同じ取った時刻のときだけ消す——その間に店が住所を保存し直していたら、新しい座標を消さない。
 */
export const expireStoreCoordinates = async (db: Db, store: { id: string; geocodedAt: string }): Promise<void> => {
  await db.prepare(`UPDATE stores SET lat = NULL, lng = NULL, geocoded_at = NULL WHERE id = ?1 AND geocoded_at = ?2`).bind(store.id, store.geocodedAt).run();
};

/** 起点を丸める桁（小数2桁＝緯度で約1.1km） */
export const COARSE_ORIGIN_DECIMALS = 2;

/**
 * `beforeIso` より前の取得の起点のうち、Google で位置に直したもの（'place'）と出どころの分からない古い行（NULL）を
 * 小数2桁に丸める。端末の現在地（'device'）は Google の中身ではないので触らない。丸め済みの行は選ばない（冪等）。
 */
export const coarsenOldPlaceOrigins = async (db: Db, beforeIso: string): Promise<void> => {
  await db
    .prepare(
      `UPDATE fetch_logs SET origin_lat = ROUND(origin_lat, ?2), origin_lng = ROUND(origin_lng, ?2)
       WHERE at < ?1 AND (origin_source IS NULL OR origin_source = 'place')
         AND (origin_lat <> ROUND(origin_lat, ?2) OR origin_lng <> ROUND(origin_lng, ?2))`,
    )
    .bind(beforeIso, COARSE_ORIGIN_DECIMALS)
    .run();
};
