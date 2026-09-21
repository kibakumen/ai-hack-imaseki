// 店のホームページから雰囲気画像の URL を取る実物（差し替え口 StoreImageFetcher・lib/ports.ts）。
// og:image / twitter:image の meta を読むだけで、鍵は要らない
// （速成版 `sprint/lib/ogImage.ts` の移植・2026-09-22 本人の指摘「お店の画像もほしい」）。
//
// 打ち切りは自分で持たない——呼ぶ側（usecases/storeImage）が deps.clock + AbortSignal で数える
// （geocoding.ts と同じ置き方。raceDeadline の注）。
//
// **SSRF の備え**（速成版は http/https の確認だけだった。ここでは同等以上にする・本人の指示）:
//   ① http/https 以外の scheme を断る（速成版と同じ）
//   ② ホスト名がループバック・リンクローカル・プライベート帯・クラウドのメタデータ（169.254.169.254 等）
//      の**リテラル**なら断る。⚠️ Workers ランタイムはここで自分から DNS を引けない
//      （実行者への契約・確度: 高確率で残存経路）——公開のホスト名が DNS の答えで内部アドレスを
//      指す手口までは、この層だけでは塞げない。Cloudflare の Workers はそもそも RFC1918 の
//      プライベート帯へは経路を持たないため実害は小さいと見立てているが、断定はしない
//   ③ リダイレクトは自動で追わず（`redirect: "manual"`）、行き先ごとに②を再検査してから
//      手動で追う（最大3回）——公開の URL から内部アドレスへ跳ぶ手口を塞ぐ
//      （速成版は自動追従で、ここの備えを1つも持たなかった）
//   ④ 応答の本文は最大 MAX_HTML_BYTES まで（打ち切って読む。速成版と同じ値）
//   ⑤ 抜き出した画像の URL も http/https 以外・内部アドレスなら断る（<img src> に内部の値を渡さない）

import type { StoreImageFetcher } from "../ports";

const MAX_HTML_BYTES = 200_000;
const MAX_REDIRECTS = 3;

const IMAGE_META_PATTERN =
  /<meta[^>]+(?:property|name)\s*=\s*["'](?:og:image|twitter:image)["'][^>]+content\s*=\s*["']([^"']+)["'][^>]*>|<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+(?:property|name)\s*=\s*["'](?:og:image|twitter:image)["'][^>]*>/i;

const isIPv4Literal = (host: string): boolean => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);

/** IPv4 のリテラルが、ループバック・プライベート帯・リンクローカル（クラウドのメタデータ含む）かどうか。 */
const isBlockedIPv4 = (host: string): boolean => {
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true; // 壊れた形は塞ぐ側へ倒す
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 127) return true; // ループバック
  if (a === 10) return true; // プライベート
  if (a === 172 && b >= 16 && b <= 31) return true; // プライベート
  if (a === 192 && b === 168) return true; // プライベート
  if (a === 169 && b === 254) return true; // リンクローカル（クラウドのメタデータ 169.254.169.254 を含む）
  if (a >= 224) return true; // マルチキャスト・予約
  return false;
};

/** IPv6 のリテラルが、ループバック・リンクローカル・ユニークローカル（fc00::/7）かどうか。 */
const isBlockedIPv6 = (rawHost: string): boolean => {
  const host = rawHost.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "::1" || host === "::") return true;
  if (host.startsWith("fe80:") || host.startsWith("fec0:")) return true; // リンクローカル
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true; // fc00::/7 ユニークローカル
  if (host.startsWith("::ffff:")) {
    // IPv4 射影アドレス（::ffff:10.0.0.1 のような形）は、内側の IPv4 として見る。
    const mapped = host.slice("::ffff:".length);
    return isIPv4Literal(mapped) ? isBlockedIPv4(mapped) : true;
  }
  return false;
};

/** ホスト名の名前そのもの（IP でない）で、内部を指すとわかっているもの。 */
const isBlockedHostname = (host: string): boolean => {
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) return true;
  if (lower === "metadata" || lower === "metadata.google.internal") return true;
  return false;
};

/** この URL へ出て（またはリダイレクト先として追って）よいか。http/https だけ・内部を指さない。 */
const isSafeUrl = (url: URL): boolean => {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname;
  if (isBlockedHostname(host)) return false;
  if (isIPv4Literal(host)) return !isBlockedIPv4(host);
  if (host.includes(":")) return !isBlockedIPv6(host);
  return true;
};

/** ストリームを最大 maxBytes まで読み、途中で打ち切って文字列化する（速成版と同じ考え）。 */
const readLimitedText = async (response: Response, maxBytes: number): Promise<string> => {
  const body = response.body;
  if (!body) return "";

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
};

const extractImageUrl = (html: string): string | null => {
  const match = html.match(IMAGE_META_PATTERN);
  return match ? (match[1] ?? match[2] ?? null) : null;
};

const resolveAbsoluteUrl = (candidate: string, baseUrl: string): URL | null => {
  try {
    return new URL(candidate, baseUrl);
  } catch {
    return null;
  }
};

/**
 * 安全な行き先だけを辿って取りに行く。リダイレクトは自動で追わず、行き先ごとに `isSafeUrl` を
 * 再検査してから手動で追う（最大 MAX_REDIRECTS 回）。行き先が安全でない・形が読めない・
 * 段数を超えたら、その場で諦める（`null`）。
 */
const fetchSafely = async (
  start: URL,
  fetchImpl: typeof globalThis.fetch,
  signal: AbortSignal | undefined,
): Promise<{ response: Response; finalUrl: URL } | null> => {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isSafeUrl(current)) return null;
    let response: Response;
    try {
      response = await fetchImpl(current.toString(), { redirect: "manual", signal, headers: { accept: "text/html" } });
    } catch {
      return null;
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || hop === MAX_REDIRECTS) return null;
      const next = resolveAbsoluteUrl(location, current.toString());
      if (!next) return null;
      current = next;
      continue;
    }
    return { response, finalUrl: current };
  }
  return null;
};

export type StoreImageOptions = {
  /** 差し替え用（検査で偽物を渡す）。既定はこの実行環境の fetch */
  fetch?: typeof globalThis.fetch;
};

export const createStoreImageFetcher = ({ fetch: fetchImpl = globalThis.fetch }: StoreImageOptions = {}): StoreImageFetcher => ({
  fetch: async (homepageUrl, opts) => {
    let base: URL;
    try {
      base = new URL(homepageUrl);
    } catch {
      return { ok: false };
    }
    if (!isSafeUrl(base)) return { ok: false };

    try {
      const followed = await fetchSafely(base, fetchImpl, opts.signal);
      if (!followed || !followed.response.ok) return { ok: false };

      const html = await readLimitedText(followed.response, MAX_HTML_BYTES);
      const rawImageUrl = extractImageUrl(html);
      if (!rawImageUrl) return { ok: false };

      const image = resolveAbsoluteUrl(rawImageUrl, followed.finalUrl.toString());
      if (!image || !isSafeUrl(image)) return { ok: false };

      return { ok: true, imageUrl: image.toString() };
    } catch {
      // 打ち切り（AbortError）・通信の失敗のどれも「取れなかった」。
      return { ok: false };
    }
  },
});
