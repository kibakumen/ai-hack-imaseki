// 見分け（客・店・運営）と Origin の確かめ（設計書「入口（API）の一覧」）。
// Cookie の値を SHA-256 にして探す（token_hash・sessions.token_hash）ので、Hasher を deps から受け取る
// （crypto を直接は呼ばない・依存の向き）。

import type { Deps } from "../ports";
import { extendSession, findSessionByTokenHash } from "../repo/sessions";
import { SESSION_RENEW_WITHIN_SECONDS, SESSION_MAX_AGE_SECONDS } from "../schemas/limits";
import { CUSTOMER_COOKIE_NAME, SESSION_COOKIE_MAX_AGE_SECONDS, SESSION_COOKIE_NAME, parseCookies, serializeCookie } from "./cookies";

export type SessionIdentity = {
  accountId: string;
  role: "store" | "admin";
  storeId: string | null;
  mustChangePassword: boolean;
  /** 期限を延ばすときに使う（表を引く鍵） */
  tokenHash: string;
  /** Cookie に載っていた生の値。延ばすときに同じ値で Set-Cookie を出し直す */
  token: string;
  expiresAt: Date;
};

/** Cookie の客の識別子を SHA-256 にして探す。無い・でたらめ・消去済みなら null（401 の元）。 */
export const identifyCustomer = async (req: Request, deps: Deps): Promise<string | null> => {
  const token = parseCookies(req.headers.get("cookie"))[CUSTOMER_COOKIE_NAME];
  if (!token) return null;
  const tokenHash = await deps.hasher.sha256Hex(token);
  const row = await deps.db.prepare(`SELECT id FROM customers WHERE token_hash = ?1 AND deleted_at IS NULL`).bind(tokenHash).first();
  return row ? (row.id as string) : null;
};

/**
 * セッションの Cookie を SHA-256 にして探す。無い・でたらめ・期限切れなら null（401 の元）。
 *
 * ⚠️ 期限の値が日付として読めないとき（表が壊れた・移し替えを間違えた）は**期限切れとして断る**
 * （フェイルクローズ・本人選択 2026-09-21）。`NaN <= 今` は常に false なので、素直に比べると
 * 壊れた値が「まだ切れていない」側へ倒れ、守りが黙って外れる。
 */
export const identifySession = async (req: Request, deps: Deps): Promise<SessionIdentity | null> => {
  const token = parseCookies(req.headers.get("cookie"))[SESSION_COOKIE_NAME];
  if (!token) return null;
  const tokenHash = await deps.hasher.sha256Hex(token);
  const row = await findSessionByTokenHash(deps.db, tokenHash);
  if (!row) return null;
  const expiresAt = new Date(row.expiresAtIso).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= deps.clock.now().getTime()) return null;
  return {
    accountId: row.accountId,
    role: row.role,
    storeId: row.storeId,
    mustChangePassword: row.mustChangePassword,
    tokenHash,
    token,
    expiresAt: new Date(expiresAt),
  };
};

/**
 * 使われるたびにセッションを延ばす（スライディングウィンドウ・本人選択／AI提示 2026-09-21）。
 * 残りが1時間（SESSION_RENEW_WITHIN_SECONDS）を切っているときだけ、表の期限と Cookie の Max-Age を
 * 今から25時間（SESSION_MAX_AGE_SECONDS）先へ動かす。
 * 延ばさないときは空の配列——毎回 Set-Cookie と UPDATE を出さないため。
 */
export const renewSession = async (deps: Deps, session: SessionIdentity): Promise<string[]> => {
  const now = deps.clock.now().getTime();
  if (session.expiresAt.getTime() - now > SESSION_RENEW_WITHIN_SECONDS * 1000) return [];
  const next = new Date(now + SESSION_MAX_AGE_SECONDS * 1000).toISOString();
  await extendSession(deps.db, session.tokenHash, next);
  return [serializeCookie(SESSION_COOKIE_NAME, session.token, SESSION_COOKIE_MAX_AGE_SECONDS)];
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
