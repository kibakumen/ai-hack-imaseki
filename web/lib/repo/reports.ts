// 通報と「最近行った店」の読み書き（要件26。設計書「ファイル構成の計画」: lib/repo は D1 の SQL）。
// 時刻の比較は、手続きが束縛した「今」と境目を引数で受ける（SQLite の datetime('now') は使わない）。
//
// ⚠️ 確保の表を読む問い合わせが2つ在るが、置き場所を `repo/reservations.ts` にしていない——
//    どちらも要件26だけのための読みで、`reports` の書き込みと必ず対で使う（通報を受け付ける条件と、
//    一覧に出す行が**同じ7日**でなければならない・`domain/report.ts` の注）。1か所で読める方が
//    ずれに気づける。確保の表の別名は `repo/reservations.ts` と同じ **`res`** で揃えてある。
//
// ⚠️ 応答に載せるのは店の名前までで、通報した客の呼び名と電話番号は1つも読まない（基準 26.8・28.2）。

import type { Deps } from "../ports";

type Db = Deps["db"];

// ---------- 書く（通報） ----------

export type NewReport = {
  id: string;
  storeId: string;
  /** 客の内部の番号（Cookie の生の値ではない・設計書「客の識別子」） */
  customerId: string;
  reason: string;
  atIso: string;
};

export const insertReport = async (db: Db, report: NewReport): Promise<void> => {
  await db
    .prepare(`INSERT INTO reports (id, store_id, customer_id, reason, at) VALUES (?1, ?2, ?3, ?4, ?5)`)
    .bind(report.id, report.storeId, report.customerId, report.reason, report.atIso)
    .run();
};

// ---------- 読む（通報を受け付ける条件・基準 26.18） ----------

export type ReportPermissionQuery = {
  customerId: string;
  storeId: string;
  /** 確保中かどうかの判定に使う「今」 */
  nowIso: string;
  /** 完了済みをいつまで遡って数えるか（`domain/report.recentWindowStart`） */
  recentFromIso: string;
};

/**
 * その客が、その店へ通報できるか（基準 26.18）。
 * 通るのは2つだけ——**確保中の確保の店**と、**7日以内に完了済みになった確保の店**。
 * 行っていない店・取り消された確保の店・期限切れのままの店・8日前の店は、どれも当たらない。
 */
export const canReportStore = async (db: Db, query: ReportPermissionQuery): Promise<boolean> => {
  const row = await db
    .prepare(
      `SELECT 1 AS found FROM reservations res` +
        ` WHERE res.customer_id = ?1 AND res.store_id = ?2` +
        ` AND ((res.status = 'active' AND res.expires_at > ?3) OR (res.status = 'completed' AND res.status_at > ?4))` +
        ` LIMIT 1`,
    )
    .bind(query.customerId, query.storeId, query.nowIso, query.recentFromIso)
    .first();
  return row !== null;
};

// ---------- 読む（最近行った店・基準 26.10〜26.12・26.15） ----------

/** 「最近行った店」の1行（画面に出す項目だけ。コード・住所・URL は読まない・基準 26.17）。 */
export type RecentStoreRow = {
  reservationId: string;
  storeId: string;
  storeName: string;
  completedAtIso: string;
};

/**
 * 完了済みになった確保のうち、境目より後のものを新しい順に（基準 26.10・26.12・26.15）。
 * 客が次の確保を作ったあとも出る——いちばん新しい確保しか見ない客のホームとは別の問い合わせ。
 */
export const listRecentStores = async (db: Db, customerId: string, recentFromIso: string): Promise<RecentStoreRow[]> => {
  const result = await db
    .prepare(
      `SELECT res.id AS reservation_id, res.store_id, res.status_at, s.name AS store_name` +
        ` FROM reservations res JOIN stores s ON s.id = res.store_id` +
        ` WHERE res.customer_id = ?1 AND res.status = 'completed' AND res.status_at > ?2` +
        ` ORDER BY res.status_at DESC, res.rowid DESC`,
    )
    .bind(customerId, recentFromIso)
    .all();
  return ((result.results ?? []) as Array<Record<string, unknown>>).map((row) => ({
    reservationId: row.reservation_id as string,
    storeId: row.store_id as string,
    storeName: (row.store_name as string | null) ?? "",
    completedAtIso: row.status_at as string,
  }));
};

// ---------- 読む（運営の通報の一覧・基準 26.6〜26.8） ----------

/** 運営の一覧の1行。どの店か・理由・日時と、行から詳細へ移るための店の番号（基準 26.7）。 */
export type AdminReportRow = {
  id: string;
  storeId: string;
  storeName: string;
  reason: string;
  atIso: string;
};

/** 新しい順（基準 26.6）。同じ時刻の2件は、後から入った方を先に出す。 */
export const listReportsForAdmin = async (db: Db): Promise<AdminReportRow[]> => {
  const result = await db
    .prepare(
      `SELECT r.id, r.store_id, r.reason, r.at, s.name AS store_name` +
        ` FROM reports r JOIN stores s ON s.id = r.store_id` +
        ` ORDER BY r.at DESC, r.rowid DESC`,
    )
    .all();
  return ((result.results ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    storeId: row.store_id as string,
    storeName: (row.store_name as string | null) ?? "",
    reason: (row.reason as string | null) ?? "",
    atIso: row.at as string,
  }));
};
