// stores の表への読み書き（設計書「ファイル構成の計画」: lib/repo は D1 の SQL）。
// 登録の時に作るのは店名と状態だけで、住所・位置・ジャンル・予算はタスク5（店の情報）が入れる。

import type { Deps } from "../ports";

type Db = Deps["db"];

export type StoreStatus = "pending" | "approved" | "banned";

export type NewStore = { id: string; name: string };

export type StoreSummary = { id: string; name: string; status: StoreStatus };

/** 1つの文にまとめて流すための文（店の登録は店・アカウント・セッションを1度に書く）。 */
export const insertStoreStatement = (db: Db, store: NewStore) =>
  db.prepare(`INSERT INTO stores (id, name, status) VALUES (?1, ?2, 'pending')`).bind(store.id, store.name);

/** 店の番号で1件。無ければ null（アカウントは在るのに店が消えている、は起きない想定）。 */
export const findStoreSummary = async (db: Db, storeId: string): Promise<StoreSummary | null> => {
  const row = await db.prepare(`SELECT id, name, status FROM stores WHERE id = ?1`).bind(storeId).first();
  if (!row) return null;
  return { id: row.id as string, name: row.name as string, status: row.status as StoreStatus };
};

// ---------- 営業許可書とカード（タスク7・要件13） ----------

/** 店のホームと運営の詳細が見る、書類まわりの3つ。 */
export type StoreDocuments = { licenseKey: string | null; licenseMime: string | null; cardRegisteredAt: string | null };

/** 店のホームが承認の状況・チェックリスト・足りない店の情報を作るために読む1行。 */
export type StoreHomeRow = StoreSummary &
  StoreDocuments & {
    address: string | null;
    genres: string[];
    budgetMin: number | null;
    budgetMax: number | null;
  };

/** `genres` の列（JSON の文字列）を配列へ。壊れていれば空（画面を落とさない）。 */
const parseGenres = (raw: unknown): string[] => {
  if (typeof raw !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((g): g is string => typeof g === "string") : [];
  } catch {
    return [];
  }
};

/** 書類の3つだけ。許可書を読む入口（店・運営）が使う。無ければ null＝そんな店は無い。 */
export const findStoreDocuments = async (db: Db, storeId: string): Promise<StoreDocuments | null> => {
  const row = await db.prepare(`SELECT license_key, license_mime, card_registered_at FROM stores WHERE id = ?1`).bind(storeId).first();
  if (!row) return null;
  return {
    licenseKey: (row.license_key as string | null) ?? null,
    licenseMime: (row.license_mime as string | null) ?? null,
    cardRegisteredAt: (row.card_registered_at as string | null) ?? null,
  };
};

/** 店のホームが要る列をまとめて1回で読む。 */
export const findStoreHomeRow = async (db: Db, storeId: string): Promise<StoreHomeRow | null> => {
  const row = await db
    .prepare(`SELECT id, name, status, address, genres, budget_min, budget_max, license_key, license_mime, card_registered_at FROM stores WHERE id = ?1`)
    .bind(storeId)
    .first();
  if (!row) return null;
  return {
    id: row.id as string,
    name: row.name as string,
    status: row.status as StoreStatus,
    address: (row.address as string | null) ?? null,
    genres: parseGenres(row.genres),
    budgetMin: (row.budget_min as number | null) ?? null,
    budgetMax: (row.budget_max as number | null) ?? null,
    licenseKey: (row.license_key as string | null) ?? null,
    licenseMime: (row.license_mime as string | null) ?? null,
    cardRegisteredAt: (row.card_registered_at as string | null) ?? null,
  };
};

/** 営業許可書の置き場と種類を差し替える（上げ直しは前のファイルを置き換える・基準 13.4）。 */
export const updateStoreLicense = async (db: Db, storeId: string, licenseKey: string, licenseMime: string): Promise<void> => {
  await db.prepare(`UPDATE stores SET license_key = ?2, license_mime = ?3 WHERE id = ?1`).bind(storeId, licenseKey, licenseMime).run();
};

/** カードの登録の口を開いた印。戻ってきた要求を突き合わせるために持つ（カードの値そのものは持たない）。 */
export const saveCardSetupSession = async (db: Db, storeId: string, sessionId: string): Promise<void> => {
  await db.prepare(`UPDATE stores SET card_setup_session_id = ?2 WHERE id = ?1`).bind(storeId, sessionId).run();
};

/** カードが登録済みになった時刻。画面と運営に出るのはこれが在るかどうかだけ（基準 13.8）。 */
export const markCardRegistered = async (db: Db, storeId: string, atIso: string): Promise<void> => {
  await db.prepare(`UPDATE stores SET card_registered_at = ?2 WHERE id = ?1`).bind(storeId, atIso).run();
};
