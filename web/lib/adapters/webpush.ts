// Web プッシュの送信（差し替え口 PushSender）の実物。**中身を載せないプッシュ**だけを送る
// （設計書「比べた案」のプッシュの行）。文面は Service Worker が GET /api/customer/push-message
// から取るので、ここには客のデータが1バイトも乗らない（基準 22.5）。
//
// 送るのは VAPID（RFC 8292）の署名だけ:
//   Authorization: vapid t=<JWT（ES256 で署名）>, k=<公開の側（base64url）>
//   TTL: <秒>                                   本文なし（RFC 8030 の「中身の無い通知」）
// 鍵の組は `scripts/v2-keys.sh vapid`（web-push generate-vapid-keys）が作った形を前提にする——
// 公開の側は 65 バイトの点（0x04 始まり）の base64url、秘密の側は 32 バイトの base64url。
// crypto を呼んでよいのは lib/adapters だけ（構造の検査と lint が見張る）。

import type { PushSender } from "../ports";

export type WebPushOptions = {
  /** VAPID の公開の側（base64url・65バイトの点）。Authorization の `k=` に載せる */
  publicKey: string;
  /** VAPID の秘密の側（base64url・32バイト）。Worker の秘密 VAPID_PRIVATE_KEY */
  privateKey: string;
  /** 運営の連絡先（【最終日】の ADMIN_CONTACT_EMAIL）。在れば `mailto:` で名乗る */
  contactEmail?: string | null;
  /** 連絡先が無いときに名乗る URL（VAPID の `sub` は mailto か https でなければならない） */
  origin?: string;
  /** 差し替え用（検査で偽物を渡す）。既定はこの実行環境の fetch */
  fetch?: typeof globalThis.fetch;
  /** 差し替え用（検査で固定の時刻を渡す）。JWT の期限にしか使わない */
  now?: () => number;
};

/** 連絡先も公開先も分からないときに名乗る URL（AI判断。実機で断られたら公開先の URL を渡す） */
const DEFAULT_ORIGIN = "https://ai-hack-v2.workers.dev";
/** JWT の寿命（RFC 8292 の上限は24時間。余裕を持って12時間・AI判断） */
const JWT_LIFETIME_SECONDS = 12 * 60 * 60;

const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const base64UrlToBytes = (value: string): Uint8Array => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
};

const textToBase64Url = (text: string): string => bytesToBase64Url(new TextEncoder().encode(text));

/** 公開の側の点から x・y を切り出し、秘密の側と合わせて署名の鍵にする。 */
const importSigningKey = async (publicKey: string, privateKey: string): Promise<CryptoKey> => {
  const point = base64UrlToBytes(publicKey);
  if (point.length !== 65 || point[0] !== 0x04) throw new Error("vapid_public_key_shape");
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: bytesToBase64Url(point.slice(1, 33)),
    y: bytesToBase64Url(point.slice(33, 65)),
    d: bytesToBase64Url(base64UrlToBytes(privateKey)),
    ext: true,
  };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
};

const signJwt = async (key: CryptoKey, claims: { aud: string; exp: number; sub: string }): Promise<string> => {
  const head = `${textToBase64Url(JSON.stringify({ typ: "JWT", alg: "ES256" }))}.${textToBase64Url(JSON.stringify(claims))}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(head));
  return `${head}.${bytesToBase64Url(new Uint8Array(signature))}`;
};

/** 保存しておいた購読から配信元の URL を取り出す（形が違えば null＝もう使えない購読）。 */
const endpointOf = (subscription: unknown): string | null => {
  const endpoint = (subscription as { endpoint?: unknown } | null)?.endpoint;
  return typeof endpoint === "string" && endpoint.startsWith("https://") ? endpoint : null;
};

export const createPushSender = ({ publicKey, privateKey, contactEmail = null, origin = DEFAULT_ORIGIN, fetch: fetchImpl = globalThis.fetch, now = Date.now }: WebPushOptions): PushSender => {
  const subject = contactEmail ? `mailto:${contactEmail}` : origin;
  // 鍵の取り込みは1回だけ（送るたびに作り直さない）。落ちた場合は送るたびにもう一度試す。
  let signingKey: Promise<CryptoKey> | null = null;
  const keyOnce = (): Promise<CryptoKey> => {
    signingKey ??= importSigningKey(publicKey, privateKey).catch((error: unknown) => {
      signingKey = null;
      throw error;
    });
    return signingKey;
  };

  return {
    send: async (subscription, opts) => {
      const endpoint = endpointOf(subscription);
      // 形の壊れた購読は、送れないだけでなく今後も送れない＝「もう無い」として消させる。
      if (!endpoint) return { ok: false, gone: true };
      try {
        const jwt = await signJwt(await keyOnce(), {
          aud: new URL(endpoint).origin,
          exp: Math.floor(now() / 1000) + JWT_LIFETIME_SECONDS,
          sub: subject,
        });
        const res = await fetchImpl(endpoint, {
          method: "POST",
          headers: { authorization: `vapid t=${jwt}, k=${publicKey}`, ttl: String(opts.ttlSeconds) },
        });
        // 404・410 は「この購読はもう無い」（RFC 8030）。呼ぶ側が表から消す（基準 22.6）。
        if (res.status === 404 || res.status === 410) return { ok: false, gone: true };
        return res.ok ? { ok: true } : { ok: false, gone: false };
      } catch {
        // 鍵の形・通信の失敗・配信元の不調。取り消しの処理は続ける（基準 22.6）。
        return { ok: false, gone: false };
      }
    },
  };
};
