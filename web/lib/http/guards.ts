// 見分け（客・店・運営）と Origin の確かめ（設計書「入口（API）の一覧」）。
// Cookie の値を SHA-256 にして探す（token_hash・sessions.token_hash）ので、Hasher を deps から受け取る
// （crypto を直接は呼ばない・依存の向き）。

import type { Deps } from "../ports";
import { findCustomerIdByTokenHash } from "../repo/customers";
import { extendSession, findSessionByTokenHash } from "../repo/sessions";
import { SESSION_ABSOLUTE_MAX_SECONDS, SESSION_RENEW_WITHIN_SECONDS, SESSION_MAX_AGE_SECONDS } from "../schemas/limits";
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
  /** 作った時刻。延ばす先を絶対の寿命（SESSION_ABSOLUTE_MAX_SECONDS）の内に収めるために使う */
  createdAt: Date;
};

/** Cookie の客の識別子を SHA-256 にして探す。無い・でたらめ・消去済みなら null（401 の元）。 */
export const identifyCustomer = async (req: Request, deps: Deps): Promise<string | null> => {
  const token = parseCookies(req.headers.get("cookie"))[CUSTOMER_COOKIE_NAME];
  if (!token) return null;
  return findCustomerIdByTokenHash(deps.db, await deps.hasher.sha256Hex(token));
};

/**
 * セッションの Cookie を SHA-256 にして探す。無い・でたらめ・期限切れなら null（401 の元）。
 *
 * ⚠️ 期限の値が日付として読めないとき（表が壊れた・移し替えを間違えた）は**期限切れとして断る**
 * （フェイルクローズ・本人選択 2026-09-21）。`NaN <= 今` は常に false なので、素直に比べると
 * 壊れた値が「まだ切れていない」側へ倒れ、守りが黙って外れる。
 *
 * 作った時刻から絶対の寿命（14日）を過ぎたセッションも断る（2026-09-25 監査の指摘 安全-08）。
 * 作った時刻が読めない行（migration 0008 より前に作られた行）も、同じく切れたものとして断る。
 */
export const identifySession = async (req: Request, deps: Deps): Promise<SessionIdentity | null> => {
  const token = parseCookies(req.headers.get("cookie"))[SESSION_COOKIE_NAME];
  if (!token) return null;
  const tokenHash = await deps.hasher.sha256Hex(token);
  const row = await findSessionByTokenHash(deps.db, tokenHash);
  if (!row) return null;
  const now = deps.clock.now().getTime();
  const expiresAt = new Date(row.expiresAtIso).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
  const createdAt = row.createdAtIso === "" ? Number.NaN : new Date(row.createdAtIso).getTime();
  if (!Number.isFinite(createdAt) || now - createdAt >= SESSION_ABSOLUTE_MAX_SECONDS * 1000) return null;
  return {
    accountId: row.accountId,
    role: row.role,
    storeId: row.storeId,
    mustChangePassword: row.mustChangePassword,
    tokenHash,
    token,
    expiresAt: new Date(expiresAt),
    createdAt: new Date(createdAt),
  };
};

/**
 * 使われるたびにセッションを延ばす（スライディングウィンドウ・本人選択／AI提示 2026-09-21）。
 * 残りが1時間（SESSION_RENEW_WITHIN_SECONDS）を切っているときだけ、表の期限と Cookie の Max-Age を
 * 今から25時間（SESSION_MAX_AGE_SECONDS）先へ動かす。
 * 延ばさないときは空の配列——毎回 Set-Cookie と UPDATE を出さないため。
 *
 * 延ばす先は、作った時刻から絶対の寿命（SESSION_ABSOLUTE_MAX_SECONDS）の内に収める（安全-08）。
 * 収めた結果いまの期限より先へ動かないなら、延ばさない（表も Cookie も触らない）。
 */
export const renewSession = async (deps: Deps, session: SessionIdentity): Promise<string[]> => {
  const now = deps.clock.now().getTime();
  if (session.expiresAt.getTime() - now > SESSION_RENEW_WITHIN_SECONDS * 1000) return [];
  const next = Math.min(now + SESSION_MAX_AGE_SECONDS * 1000, session.createdAt.getTime() + SESSION_ABSOLUTE_MAX_SECONDS * 1000);
  if (next <= session.expiresAt.getTime()) return [];
  await extendSession(deps.db, session.tokenHash, new Date(next).toISOString());
  const maxAgeSeconds = Math.min(SESSION_COOKIE_MAX_AGE_SECONDS, Math.ceil((next - now) / 1000));
  return [serializeCookie(SESSION_COOKIE_NAME, session.token, maxAgeSeconds)];
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
