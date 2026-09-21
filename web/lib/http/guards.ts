// 見分け（客・店・運営）と Origin の確かめ（設計書「入口（API）の一覧」）。
// Cookie の値を SHA-256 にして探す（token_hash・sessions.token_hash）ので、Hasher を deps から受け取る
// （crypto を直接は呼ばない・依存の向き）。

import type { Deps } from "../ports";
import { CUSTOMER_COOKIE_NAME, SESSION_COOKIE_NAME, parseCookies } from "./cookies";

export type SessionIdentity = { accountId: string; role: "store" | "admin"; storeId: string | null };

/** Cookie の客の識別子を SHA-256 にして探す。無い・でたらめ・消去済みなら null（401 の元）。 */
export const identifyCustomer = async (req: Request, deps: Deps): Promise<string | null> => {
  const token = parseCookies(req.headers.get("cookie"))[CUSTOMER_COOKIE_NAME];
  if (!token) return null;
  const tokenHash = await deps.hasher.sha256Hex(token);
  const row = await deps.db.prepare(`SELECT id FROM customers WHERE token_hash = ?1 AND deleted_at IS NULL`).bind(tokenHash).first();
  return row ? (row.id as string) : null;
};

/** セッションの Cookie を SHA-256 にして探す。無い・でたらめ・期限切れなら null（401 の元）。 */
export const identifySession = async (req: Request, deps: Deps): Promise<SessionIdentity | null> => {
  const token = parseCookies(req.headers.get("cookie"))[SESSION_COOKIE_NAME];
  if (!token) return null;
  const tokenHash = await deps.hasher.sha256Hex(token);
  const row = await deps.db
    .prepare(
      `SELECT sessions.expires_at AS expires_at, accounts.id AS account_id, accounts.role AS role, accounts.store_id AS store_id
       FROM sessions JOIN accounts ON accounts.id = sessions.account_id
       WHERE sessions.token_hash = ?1`,
    )
    .bind(tokenHash)
    .first();
  if (!row) return null;
  if (new Date(row.expires_at as string).getTime() <= deps.clock.now().getTime()) return null;
  return { accountId: row.account_id as string, role: row.role as "store" | "admin", storeId: (row.store_id as string | null) ?? null };
};

/**
 * 状態を変える要求（GET 以外）の Origin が、要求そのものの URL と同じオリジンか。合わなければ 403 の元。
 * Host ヘッダーには頼らない（要求に Host が乗るとは限らない。手元の Request オブジェクトには無い）。
 * 要求の URL 自身のオリジンと比べれば、実物の Worker でも受け入れ検査でも同じ判定になる。
 */
export const checkOrigin = (req: Request): boolean => {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(req.url).origin;
  } catch {
    return false;
  }
};
