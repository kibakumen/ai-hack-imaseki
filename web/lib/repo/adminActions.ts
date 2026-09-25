// 運営の操作の記録（2026-09-25 監査の指摘 運営-01・migrations/0011）。lib/repo は D1 の SQL。
//
// 承認・取り消し・戻す・仮のパスワードの発行・許可書の閲覧・運営のメモ・承認後の変更の確かめを、
// 「誰が・いつ・なぜ」つきで1行ずつ残す。**追加だけ**——書き換えと消去は表のトリガーが断る。
// それまで残るのは停止と戻すのときに console へ出す1行（店の番号だけ）で、しかも本番では読めなかった。
//
// ⚠️ 客を指す値は置かない。`detail` は数だけ（取り消した確保の数・通知を送った人数など）。

import type { Deps } from "../ports";
import { updateAccountPasswordStatement } from "./accounts";
import type { D1PreparedStatement } from "./d1";
import { deleteSessionsByAccountStatement } from "./sessions";

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

/**
 * 運営が店のパスワードを仮のものに置き換える（【最終日】要件14の基準 14.10〜14.14）。3つの文を1つのまとまり（`db.batch`）で流す:
 * パスワードの置き換えと「次に決め直す」の印・そのアカウントのセッションを全部切る・発行した記録。
 * 記録が書けずに落ちたとき（本番で migration 0011 を当て忘れた、など）、パスワードだけ変わりセッションも切れて、
 * 仮のパスワードはどこにも無く記録も無い、という形を作らない（2026-09-25 監査の指摘 運営-01 のレビュー）。
 */
export const replacePasswordByAdmin = async (db: Db, accountId: string, passwordHash: string, action: NewAdminAction): Promise<void> => {
  await db.batch([updateAccountPasswordStatement(db, accountId, passwordHash, true), deleteSessionsByAccountStatement(db, accountId), insertAdminActionStatement(db, action)]);
};

/** 読んだ値が「名前 → 値」の組か（並びや null ではない）。 */
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** JSON の文字列を読む。壊れていれば null。 */
const parseJson = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/**
 * `detail` の JSON（名前 → 数か真偽の組）を読む。数と真偽だけを拾い、それ以外は落とす（壊れていれば空）。
 * 並びを読む道具（repo/d1 の parseJsonArray）とは形が違うので、ここに置く。
 */
const parseDetail = (raw: unknown): AdminActionDetail => {
  const parsed = typeof raw === "string" ? parseJson(raw) : null;
  if (!isRecord(parsed)) return {};
  return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === "number" || typeof v === "boolean")) as AdminActionDetail;
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
