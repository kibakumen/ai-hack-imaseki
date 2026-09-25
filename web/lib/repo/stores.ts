// stores の表への読み書き（設計書「ファイル構成の計画」: lib/repo は D1 の SQL）。
// 登録の時に作るのは店名と状態だけで、住所・位置・ジャンル・予算はタスク5（店の情報）が入れる。

import type { Deps } from "../ports";
import { insertAccountStatement, type NewAccount } from "./accounts";
import { changedRows, parseStringList } from "./d1";
import { insertSessionStatement, type NewSession } from "./sessions";
import type { StoreProfile } from "../schemas/store";

type Db = Deps["db"];

export type StoreStatus = "pending" | "approved" | "banned";

/** `createdAtIso` は店の登録の時刻（同点・同距離のときの並び・要件6の基準 6.4。タスク9 で追加）。 */
export type NewStore = { id: string; name: string; createdAtIso: string };

export type StoreSummary = { id: string; name: string; status: StoreStatus };

const insertStoreStatement = (db: Db, store: NewStore) =>
  db.prepare(`INSERT INTO stores (id, name, created_at, status) VALUES (?1, ?2, ?3, 'pending')`).bind(store.id, store.name, store.createdAtIso);

/**
 * 店の登録（基準 12.1）。店・アカウント・セッションを1つのまとまり（`db.batch`）で書く——途中で落ちて、
 * 店だけが残る形を作らない。メールアドレスの重複は表の UNIQUE が例外で教える（呼ぶ側が
 * `isEmailTakenError` で受ける）。2026-09-25 監査の指摘 設計-13 で手続きの中から移した。
 */
export const insertStoreWithAccountAndSession = async (db: Db, input: { store: NewStore; account: NewAccount; session: NewSession }): Promise<void> => {
  await db.batch([insertStoreStatement(db, input.store), insertAccountStatement(db, input.account), insertSessionStatement(db, input.session)]);
};

/**
 * 店とアカウントだけを1つのまとまりで書く（セッションは作らない）。デモの種データの投入（usecases/seedDemo）が使う
 * ——登録の画面を通らずに店を作るので、入ったままの画面を残さない。店だけが残る形を作らないのは上と同じ。
 */
export const insertStoreWithAccount = async (db: Db, input: { store: NewStore; account: NewAccount }): Promise<void> => {
  await db.batch([insertStoreStatement(db, input.store), insertAccountStatement(db, input.account)]);
};

// ---------- 店の情報（タスク5・要件15） ----------

/** 保存する店の情報（位置は住所から直したもの・基準 15.9）。 */
export type StoreProfileRecord = {
  name: string;
  address: string;
  url: string | null;
  genres: string[];
  menus: string[];
  budgetMin: number;
  budgetMax: number;
  lat: number;
  lng: number;
};

/** 店の情報を読む。まだ入れていない項目は空か null（登録の直後は店名だけが入っている）。 */
export const findStoreProfile = async (db: Db, storeId: string): Promise<StoreProfile | null> => {
  const row = await db
    .prepare(`SELECT name, address, url, genres, menus, budget_min, budget_max FROM stores WHERE id = ?1`)
    .bind(storeId)
    .first();
  if (!row) return null;
  return {
    name: row.name as string,
    address: (row.address as string | null) ?? "",
    url: (row.url as string | null) ?? null,
    genres: parseStringList(row.genres),
    menus: parseStringList(row.menus),
    budgetMin: (row.budget_min as number | null) ?? null,
    budgetMax: (row.budget_max as number | null) ?? null,
  };
};

/**
 * 店の情報と位置を1度に書き換える（住所と位置がずれた形を残さない・基準 15.9）。
 * `geocodedAt` は位置を Google で直した時刻（migration 0009・設計-20）。手で置いた位置（デモの店）は渡さない＝NULL
 * ——Google の利用条件の30日の手入れ（usecases/googleUpkeep）は、時刻のある座標だけを取り直す。
 */
export const updateStoreProfile = async (db: Db, storeId: string, profile: StoreProfileRecord & { geocodedAt?: string | null }): Promise<void> => {
  await db
    .prepare(
      `UPDATE stores SET name = ?2, address = ?3, url = ?4, genres = ?5, menus = ?6, budget_min = ?7, budget_max = ?8, lat = ?9, lng = ?10, geocoded_at = ?11 WHERE id = ?1`,
    )
    .bind(
      storeId,
      profile.name,
      profile.address,
      profile.url,
      JSON.stringify(profile.genres),
      JSON.stringify(profile.menus),
      profile.budgetMin,
      profile.budgetMax,
      profile.lat,
      profile.lng,
      profile.geocodedAt ?? null,
    )
    .run();
};

/** 保存済みの住所と位置（住所を変えていない保存で地図へ問い合わせないため・2026-09-25 監査の指摘 店-18）。 */
export type StoreLocation = { address: string | null; lat: number | null; lng: number | null; url: string | null };

export const findStoreLocation = async (db: Db, storeId: string): Promise<StoreLocation | null> => {
  const row = await db.prepare(`SELECT address, lat, lng, url FROM stores WHERE id = ?1`).bind(storeId).first();
  if (!row) return null;
  return {
    address: (row.address as string | null) ?? null,
    lat: typeof row.lat === "number" ? row.lat : null,
    lng: typeof row.lng === "number" ? row.lng : null,
    url: (row.url as string | null) ?? null,
  };
};

/**
 * 店の情報だけを書き換え、位置（lat・lng・geocoded_at）は触らない（住所を変えていない保存・店-18）。
 * 位置を直した時刻も触らないので、Google の利用条件の30日の手入れ（usecases/googleUpkeep）の起点はずれない。
 */
export const updateStoreDetails = async (db: Db, storeId: string, profile: Omit<StoreProfileRecord, "lat" | "lng">): Promise<void> => {
  await db
    .prepare(`UPDATE stores SET name = ?2, address = ?3, url = ?4, genres = ?5, menus = ?6, budget_min = ?7, budget_max = ?8 WHERE id = ?1`)
    .bind(storeId, profile.name, profile.address, profile.url, JSON.stringify(profile.genres), JSON.stringify(profile.menus), profile.budgetMin, profile.budgetMax)
    .run();
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
    /** カードの登録の口を開いて、まだ確かめていない（控えの番号が在り、登録済みでない）。不具合-01 */
    cardSetupPending: boolean;
  };

/**
 * 承認済み（客に見せてよい）店の、登録の URL。無い店・承認前・止められた店は null（店の画像の入口・安全-12）。
 * URL を登録していない承認済みの店は `{ url: null }`。
 */
export const findApprovedStoreUrl = async (db: Db, storeId: string): Promise<{ url: string | null } | null> => {
  const row = await db.prepare(`SELECT url FROM stores WHERE id = ?1 AND status = 'approved'`).bind(storeId).first();
  if (!row) return null;
  const url = (row as { url?: unknown }).url;
  return { url: typeof url === "string" && url !== "" ? url : null };
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
    .prepare(
      `SELECT id, name, status, address, genres, budget_min, budget_max, license_key, license_mime, card_registered_at, card_setup_session_id FROM stores WHERE id = ?1`,
    )
    .bind(storeId)
    .first();
  if (!row) return null;
  return {
    cardSetupPending: row.card_setup_session_id !== null && row.card_setup_session_id !== undefined && row.card_registered_at === null,
    id: row.id as string,
    name: row.name as string,
    status: row.status as StoreStatus,
    address: (row.address as string | null) ?? null,
    genres: parseStringList(row.genres),
    budgetMin: (row.budget_min as number | null) ?? null,
    budgetMax: (row.budget_max as number | null) ?? null,
    licenseKey: (row.license_key as string | null) ?? null,
    licenseMime: (row.license_mime as string | null) ?? null,
    cardRegisteredAt: (row.card_registered_at as string | null) ?? null,
  };
};

/**
 * 営業許可書の置き場と種類を差し替える（上げ直しは前のファイルを置き換える・基準 13.4）。
 * 上げた時刻も残す——運営が「上げ直された」ことに気づくため（2026-09-25 監査の指摘 運営-05・migrations/0011）。
 */
export const updateStoreLicense = async (db: Db, storeId: string, licenseKey: string, licenseMime: string, uploadedAtIso: string): Promise<void> => {
  await db
    .prepare(`UPDATE stores SET license_key = ?2, license_mime = ?3, license_uploaded_at = ?4 WHERE id = ?1`)
    .bind(storeId, licenseKey, licenseMime, uploadedAtIso)
    .run();
};

// ---------- 営業許可書を消す（2026-09-25 監査の指摘 安全-20 の案1） ----------

/** 営業許可書のファイルの鍵（今の分と承認の写し）と店の状況。消す手続きが読む。 */
export type StoreLicenseKeys = { status: StoreStatus; licenseKey: string | null; approvedLicenseKey: string | null };

export const findStoreLicenseKeys = async (db: Db, storeId: string): Promise<StoreLicenseKeys | null> => {
  const row = await db.prepare(`SELECT status, license_key, approved_license_key FROM stores WHERE id = ?1`).bind(storeId).first();
  if (!row) return null;
  return {
    status: row.status as StoreStatus,
    licenseKey: (row.license_key as string | null) ?? null,
    approvedLicenseKey: (row.approved_license_key as string | null) ?? null,
  };
};

/**
 * 止められた店の許可書の鍵を表から外す（今の分と承認の写しの両方）。**止められている間だけ**当たる
 * （読んでから書くまでに戻されたら外さない）。当たれば true。ファイルそのものは呼ぶ側が置き場から消す。
 */
export const clearBannedStoreLicense = async (db: Db, storeId: string): Promise<boolean> => {
  const result = await db
    .prepare(
      `UPDATE stores SET license_key = NULL, license_mime = NULL, license_uploaded_at = NULL, approved_license_key = NULL, approved_license_mime = NULL WHERE id = ?1 AND status = 'banned'`,
    )
    .bind(storeId)
    .run();
  return changedRows(result) > 0;
};

/**
 * 承認の前の店が自分の許可書を取り下げる。**未承認のままで、読んだ鍵のままのときだけ**当たる——読んでから書くまでに
 * 承認されたら（承認の写しがその鍵を指す）外さない。当たれば true。
 */
export const clearPendingStoreLicense = async (db: Db, storeId: string, licenseKey: string): Promise<boolean> => {
  const result = await db
    .prepare(`UPDATE stores SET license_key = NULL, license_mime = NULL, license_uploaded_at = NULL WHERE id = ?1 AND status <> 'approved' AND license_key = ?2`)
    .bind(storeId, licenseKey)
    .run();
  return changedRows(result) > 0;
};

/** カードの登録の口を開いた印。戻ってきた要求を突き合わせるために持つ（カードの値そのものは持たない）。 */
export const saveCardSetupSession = async (db: Db, storeId: string, sessionId: string): Promise<void> => {
  await db.prepare(`UPDATE stores SET card_setup_session_id = ?2 WHERE id = ?1`).bind(storeId, sessionId).run();
};

/**
 * 確かめに使う控えの番号（2026-09-25 カード登録が画面から完了しない件（不具合-01）の案1）。画面は番号を持たないので、
 * 確かめの入口はここで読んだ番号だけを外のサービスに照会する。控えが無ければ null。
 */
export const findCardSetupSession = async (db: Db, storeId: string): Promise<string | null> => {
  const row = await db.prepare(`SELECT card_setup_session_id FROM stores WHERE id = ?1`).bind(storeId).first();
  const sessionId = (row as { card_setup_session_id?: unknown } | null)?.card_setup_session_id;
  return typeof sessionId === "string" && sessionId !== "" ? sessionId : null;
};

/**
 * カードが登録済みになった時刻。画面と運営に出るのはこれが在るかどうかだけ（基準 13.8）。
 * 確かめ終えた控えの番号は消す（画面が開くたびに確かめ直さない・不具合-01）。
 */
export const markCardRegistered = async (db: Db, storeId: string, atIso: string): Promise<void> => {
  await db.prepare(`UPDATE stores SET card_registered_at = ?2, card_setup_session_id = NULL WHERE id = ?1`).bind(storeId, atIso).run();
};
