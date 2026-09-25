// 運営の操作の記録（2026-09-25 監査の指摘 運営-01・migrations/0011）。lib/repo は D1 の SQL。
//
// 承認・取り消し・戻す・仮のパスワードの発行・許可書の閲覧・運営のメモ・承認後の変更の確かめを、
// 「誰が・いつ・なぜ」つきで1行ずつ残す。**追加だけ**——書き換えと消去は表のトリガーが断る。
// それまで残るのは停止と戻すのときに console へ出す1行（店の番号だけ）で、しかも本番では読めなかった。
//
// ⚠️ 客を指す値は置かない。`detail` は数だけ（取り消した確保の数・通知を送った人数など）。

import type { Deps } from "../ports";
import type { D1PreparedStatement } from "./d1";

type Db = Deps["db"];

/** 記録する操作（表の CHECK と同じ語）。 */
export type AdminActionKind = "approve" | "ban" | "restore" | "temp_password" | "view_license" | "note" | "acknowledge";

/** 操作に添える数（取り消した確保の数・通知を送った人数・連絡済みにしたか）。自由な文字列は置かない。 */
export type AdminActionDetail = Record<string, number | boolean>;

export type NewAdminAction = {
  id: string;
  /** 操作した運営のアカウントの番号（セッションから・defineRoute の ctx.accountId） */
  actorAccountId: string;
  action: AdminActionKind;
  storeId: string;
  /** 取り消し・戻すの理由、メモの本文。無ければ null */
  reason: string | null;
  detail: AdminActionDetail | null;
  atIso: string;
};

/** 店の詳細に出す1行。操作した人はメールアドレスで出す（アカウントが消えていれば null）。 */
export type AdminActionRow = {
  id: string;
  action: AdminActionKind;
  actorEmail: string | null;
  reason: string | null;
  detail: AdminActionDetail;
  at: string;
};

const COLUMNS = "id, actor_account_id, action, store_id, reason, detail, at";

const values = (action: NewAdminAction): unknown[] => [
  action.id,
  action.actorAccountId,
  action.action,
  action.storeId,
  action.reason,
  action.detail ? JSON.stringify(action.detail) : null,
  action.atIso,
];

/** 1行を足す文（`db.batch` に入れるため、流さずに返す）。 */
export const insertAdminActionStatement = (db: Db, action: NewAdminAction): D1PreparedStatement =>
  db.prepare(`INSERT INTO admin_actions (${COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`).bind(...values(action));

/**
 * **直前の文が行を変えたときだけ**1行を足す文。`db.batch` の中で、状況の書き換え（前の状況を WHERE に入れた
 * UPDATE）の直後に置く——同時に来た操作に負けて状況が変わらなかったとき、した操作の記録を残さないため。
 * SQLite の `changes()` は、同じ接続で直前に終わった書き込みの行数を返す（D1 の batch は1つの接続で順に流す）。
 */
export const insertAdminActionIfChangedStatement = (db: Db, action: NewAdminAction): D1PreparedStatement =>
  db.prepare(`INSERT INTO admin_actions (${COLUMNS}) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7 WHERE changes() > 0`).bind(...values(action));

export const insertAdminAction = async (db: Db, action: NewAdminAction): Promise<void> => {
  await insertAdminActionStatement(db, action).run();
};

/** `detail` の JSON を読む。数と真偽だけを拾い、それ以外は落とす（壊れていれば空）。 */
const parseDetail = (raw: unknown): AdminActionDetail => {
  if (typeof raw !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === "number" || typeof v === "boolean")) as AdminActionDetail;
  } catch {
    return {};
  }
};

/** その店への運営の操作を、新しい順に `limit` 件まで。 */
export const listAdminActionsForStore = async (db: Db, storeId: string, limit: number): Promise<AdminActionRow[]> => {
  const result = await db
    .prepare(
      `SELECT aa.id, aa.action, aa.reason, aa.detail, aa.at, a.email AS actor_email
         FROM admin_actions aa
         LEFT JOIN accounts a ON a.id = aa.actor_account_id
        WHERE aa.store_id = ?1
        ORDER BY aa.at DESC, aa.rowid DESC
        LIMIT ?2`,
    )
    .bind(storeId, limit)
    .all();
  return ((result.results ?? []) as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    action: row.action as AdminActionKind,
    actorEmail: (row.actor_email as string | null) ?? null,
    reason: (row.reason as string | null) ?? null,
    detail: parseDetail(row.detail),
    at: row.at as string,
  }));
};
