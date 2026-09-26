// Google の地図サービスから来た店の座標の手入れ（2026-09-25 監査の指摘 設計-20 の案1・migration 0009）。
// 利用条件は、Geocoding で得た緯度と経度を連続30日までしか手元に置けないとしている。ここは読み書きの文だけを持ち、
// いつ・何日で・どの失敗で消すか、は手続き（usecases/googleUpkeep）が決める。
//
// ⚠️ 記録の表（fetch_logs など5つ）には触らない。取得の起点は、2026-09-26 の本人選択で Google から得た座標を
// 書かない形に変え（usecases/fetchOffers）、既にある行は migration 0016 が1回だけ消した（基準 27.7 の1回だけの例外）。

import type { Deps } from "../ports";
import { changedRows } from "./d1";

type Db = Deps["db"];

/** 取り直す店1件（住所で Google に聞き直す）。`hasCoordinates` が偽なら、外の障害で座標を消したまま戻るのを待つ店。 */
export type StoreToRegeocode = { id: string; address: string; geocodedAt: string; hasCoordinates: boolean };

/**
 * `sinceIso` より前に Google で位置に直した店を `limit` 件まで。**座標がまだ在る店を先に**、その中は古い順
 * （期限が迫っている店に、1回に取り直す数を使う）。座標を消した店は、その後ろで障害が明けるのを待つ。
 * 取った時刻の無い店（手で置いた座標＝デモの店）は選ばない——Google の中身ではないものを Google の答えで上書きしない。
 */
export const findStoresToRegeocode = async (db: Db, sinceIso: string, limit: number): Promise<StoreToRegeocode[]> => {
  const result = await db
    .prepare(
      `SELECT id, address, geocoded_at, lat IS NOT NULL AS has_coordinates FROM stores
       WHERE geocoded_at IS NOT NULL AND geocoded_at < ?1 AND address IS NOT NULL AND address <> ''
       ORDER BY lat IS NULL ASC, geocoded_at ASC LIMIT ?2`,
    )
    .bind(sinceIso, limit)
    .all();
  return result.results.map((row) => ({
    id: String(row.id),
    address: String(row.address),
    geocodedAt: String(row.geocoded_at),
    hasCoordinates: Number(row.has_coordinates) === 1,
  }));
};

/**
 * 取り直した座標で書き換える（外の障害で消していた座標も、これで戻る）。
 * 住所がその間に変わっていたら何もしない（新しい住所の保存が先に位置を直している）。
 */
export const refreshStoreCoordinates = async (db: Db, store: { id: string; address: string; lat: number; lng: number; geocodedAt: string }): Promise<void> => {
  await db
    .prepare(`UPDATE stores SET lat = ?3, lng = ?4, geocoded_at = ?5 WHERE id = ?1 AND address = ?2`)
    .bind(store.id, store.address, store.lat, store.lng, store.geocodedAt)
    .run();
};

/**
 * 期限を過ぎた座標を消す（店は座標が戻るまで探す結果に出ない）。
 *   - `retry: true`  … 外の障害で取り直せなかった。取った時刻は残し、取り直しの列に置いたままにする（戻ったら座標も戻る）
 *   - `retry: false` … 住所が位置に直らないと分かった。取った時刻も消し、取り直しをやめる（店が住所を保存し直すまで）
 * 読んだときと同じ取った時刻のときだけ書き換える——その間に店が住所を保存し直していたら、新しい座標を消さない。
 */
export const expireStoreCoordinates = async (db: Db, store: { id: string; geocodedAt: string }, opts: { retry: boolean }): Promise<void> => {
  const sql = opts.retry
    ? `UPDATE stores SET lat = NULL, lng = NULL WHERE id = ?1 AND geocoded_at = ?2`
    : `UPDATE stores SET lat = NULL, lng = NULL, geocoded_at = NULL WHERE id = ?1 AND geocoded_at = ?2`;
  await db.prepare(sql).bind(store.id, store.geocodedAt).run();
};

/**
 * `beforeIso` より前に Google で位置に直した座標を、**件数の上限なしで**全部消す（消した店の数を返す）。
 * 取った時刻は残す——取り直しの列に置いたままにして、住所から取り直せたら座標も戻る（`retry: true` と同じ扱い）。
 * 取り直し（1回に数件）が追いつかなくても、連続30日を超えて座標を置かないための歯止め（Service Specific Terms 6.3.1・
 * 2026-09-26 本人選択）。手で置いた座標（取った時刻が無い＝デモの店）は選ばない。
 */
export const expireOverdueStoreCoordinates = async (db: Db, beforeIso: string): Promise<number> => {
  const result = await db
    .prepare(`UPDATE stores SET lat = NULL, lng = NULL WHERE geocoded_at IS NOT NULL AND geocoded_at < ?1 AND (lat IS NOT NULL OR lng IS NOT NULL)`)
    .bind(beforeIso)
    .run();
  return changedRows(result);
};
