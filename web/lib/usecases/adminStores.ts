// 運営の店の一覧と詳細（要件24）。手続きは Deps を引数で受け、判断は持たない
// （並べ替え・絞り込み・検索の条件は SQL の側・設計書「どの判断をどこに置くか」）。
//
// ⚠️ 応答に客のデータ（電話番号・呼び名）は入れない（基準 28.2・受け入れ検査 r28）。
// ここが読むのは stores と、その店のアカウントのメールアドレスだけ。

import type { Deps } from "../ports";
import { findStoreForAdmin, listStoresForAdmin, summarizeStoresForAdmin, type AdminStoreSummary } from "../repo/adminStores";
import type { StoreStatus } from "../repo/stores";
import type { AdminStoreFilter } from "../schemas/admin";

export type AdminStoreListItem = {
  id: string;
  name: string;
  address: string | null;
  email: string | null;
  status: StoreStatus;
  /** 公開中のオファー（残りが0のものを含む・基準 24.4）を持っているか */
  publishing: boolean;
};

export type AdminStoreListResult = { items: AdminStoreListItem[]; summary: AdminStoreSummary };

export type AdminStoreDetail = AdminStoreListItem & {
  url: string | null;
  genres: string[];
  menus: string[];
  budgetMin: number | null;
  budgetMax: number | null;
  /** 営業許可書が上がっているか（基準 25.2 の足りないもの） */
  license: boolean;
  /** カードが登録済みか。カードの番号そのものは持たない（基準 13.7・13.8） */
  cardRegistered: boolean;
};

/** D1 に文字列で入っている配列（ジャンル・おすすめメニュー）を読む。壊れていれば空（画面を止めない）。 */
const parseStringArray = (json: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
};

/** 一覧と、いちばん上の集計（基準 24.1〜24.6・24.8・24.9）。集計は絞り込みと検索に左右されない。 */
export const adminStoreList = async (deps: Deps, input: { filter?: AdminStoreFilter; q?: string } = {}): Promise<AdminStoreListResult> => {
  const nowIso = deps.clock.now().toISOString();
  const [items, summary] = await Promise.all([
    listStoresForAdmin(deps.db, { filter: input.filter, q: input.q, nowIso }),
    summarizeStoresForAdmin(deps.db, nowIso),
  ]);
  return { items, summary };
};

/** 店の詳細（基準 24.10・24.11）。無ければ null（入口が 404 に倒す）。 */
export const adminStoreDetail = async (deps: Deps, storeId: string): Promise<AdminStoreDetail | null> => {
  const row = await findStoreForAdmin(deps.db, storeId, deps.clock.now().toISOString());
  if (!row) return null;
  const { genresJson, menusJson, ...rest } = row;
  return { ...rest, genres: parseStringArray(genresJson), menus: parseStringArray(menusJson) };
};
