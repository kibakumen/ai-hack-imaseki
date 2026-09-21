// Cookie の名前と、読み書きの小さな道具（設計書「比べた案と、決めたこと」: 客の識別子は
// HttpOnly・Secure・SameSite=Lax・400日の Set-Cookie）。名前は自由（受け入れ検査は
// Set-Cookie の先頭の `name=value` をそのまま見る）。

import { SESSION_MAX_AGE_SECONDS } from "../schemas/limits";

export const CUSTOMER_COOKIE_NAME = "aihack_customer";
export const SESSION_COOKIE_NAME = "aihack_session";

const DAY_SECONDS = 24 * 60 * 60;
/** 400日（7桁以上・設計書「比べた案と、決めたこと」）。 */
export const CUSTOMER_COOKIE_MAX_AGE_SECONDS = 400 * DAY_SECONDS;
/**
 * 店と運営のセッションの Cookie は、表の `sessions.expires_at` と同じ寿命にする（2時間）。
 * アクセスのたびに残りが半分を切っていれば、表と Cookie の両方を同じだけ延ばす
 * （スライディングウィンドウ・本人選択／AI提示 2026-09-21。数字の正本は schemas/limits.ts）。
 */
export const SESSION_COOKIE_MAX_AGE_SECONDS = SESSION_MAX_AGE_SECONDS;

const COMMON_ATTRS = "Path=/; HttpOnly; Secure; SameSite=Lax";

/** Set-Cookie の値を組む。 */
export const serializeCookie = (name: string, value: string, maxAgeSeconds: number): string => `${name}=${value}; ${COMMON_ATTRS}; Max-Age=${maxAgeSeconds}`;

/** ログアウトや消去のときに使う、即座に失効させる Set-Cookie の値。 */
export const expireCookie = (name: string): string => `${name}=; ${COMMON_ATTRS}; Max-Age=0`;

/** 要求の Cookie ヘッダーを名前→値の対応に直す。 */
export const parseCookies = (header: string | null): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!name) continue;
    // 壊れた percent 符号は、その1つだけを読み飛ばす（要求ごと落とさない・要件29）。
    // 識別子が読めなければ Cookie 無しと同じ＝見分けの断り（401）に落ちる。
    try {
      out[name] = decodeURIComponent(value);
    } catch {
      continue;
    }
  }
  return out;
};
