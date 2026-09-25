// 店のホームページから雰囲気画像を1枚取る実物（差し替え口 StoreImageFetcher・lib/ports.ts）。
// og:image / twitter:image の meta を読んで、その画像のバイトまで取る。鍵は要らない
// （速成版 `sprint/lib/ogImage.ts` の移植・2026-09-22 本人の指摘「お店の画像もほしい」）。
// 2026-09-25 監査の指摘 安全-19 で、URL を客の端末へ渡す形をやめて画像そのものを取る形にした
// （呼ぶのは店の情報の保存のときの1回だけ・置き場に置いて自分のオリジンから配る）。
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
//   ④ 応答の本文は最大 MAX_HTML_BYTES まで（打ち切って読む。速成版と同じ値）。読み取りは先頭から1度だけ読み進める
//      線形の処理で、正規表現は使わない（2026-09-25 監査の指摘 安全-04・ReDoS）
//   ⑤ 抜き出した画像の URL も①〜③と同じ検査をしながら取りに行く
//   ⑥ 画像は最大 STORE_IMAGE_MAX_BYTES まで（超えたら取らない）。種類は相手の名乗りでなく先頭のバイトで決め、
//      JPEG・PNG・GIF・WebP 以外（SVG・HTML など）は断る——自分のオリジンから配るので、中の script を動かさない

import { detectImageType } from "../domain/imageType";
import type { StoreImageFetcher } from "../ports";
import { STORE_IMAGE_MAX_BYTES } from "../schemas/limits";

const MAX_HTML_BYTES = 200_000;
const MAX_REDIRECTS = 3;

/**
 * meta タグ1つの長さの上限（文字）。これより長い「タグ」は読まずに飛ばす（安全-04）。
 * ふつうの og:image の meta は数百字に収まる（画像の URL の上限を足しても2,000字台）。
 */
const MAX_META_TAG_CHARS = 4096;
/** 画像として読む meta の名前（property か name の値・大小を区別しない） */
const IMAGE_META_KEYS: ReadonlySet<string> = new Set(["og:image", "twitter:image"]);

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

/**
 * ストリームを最大 maxBytes まで読み、途中で打ち切る。上限を超えたかどうかも返す
 * （HTML は超えた分を捨てて頭だけ読む・画像は超えたら取らない）。
 */
const readLimitedBytes = async (response: Response, maxBytes: number): Promise<{ bytes: Uint8Array; overflowed: boolean }> => {
  const body = response.body;
  if (!body) return { bytes: new Uint8Array(), overflowed: false };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let overflowed = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const room = maxBytes - total;
      if (value.byteLength > room) {
        chunks.push(value.subarray(0, room));
        total += room;
        overflowed = true;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  const merged = new Uint8Array(total);
  chunks.reduce((offset, chunk) => {
    merged.set(chunk, offset);
    return offset + chunk.byteLength;
  }, 0);
  return { bytes: merged, overflowed };
};

/** HTML を最大 maxBytes まで読んで文字列にする（超えた分は捨てる。速成版と同じ考え）。 */
const readLimitedText = async (response: Response, maxBytes: number): Promise<string> => new TextDecoder().decode((await readLimitedBytes(response, maxBytes)).bytes);

const isSpace = (ch: string): boolean => ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "/";

/**
 * タグ1つぶん（`<meta … >`）の属性を、先頭から1度だけ読み進めて取り出す（名前は小文字・最初の値を採る）。
 * 正規表現を使わないのは、多段の `[^>]+` が細工した入力で後戻りを重ね、時間が入力長の3乗で増えたため（安全-04）。
 */
const readAttributes = (tag: string): Map<string, string> => {
  const attributes = new Map<string, string>();
  let i = "<meta".length;
  const end = tag.length - 1; // 閉じの ">" の位置
  while (i < end) {
    while (i < end && isSpace(tag[i])) i++;
    const nameStart = i;
    while (i < end && !isSpace(tag[i]) && tag[i] !== "=") i++;
    const name = tag.slice(nameStart, i).toLowerCase();
    while (i < end && isSpace(tag[i]) && tag[i] !== "/") i++;
    let value = "";
    if (tag[i] === "=") {
      i++;
      while (i < end && isSpace(tag[i]) && tag[i] !== "/") i++;
      const quote = tag[i] === '"' || tag[i] === "'" ? tag[i] : null;
      if (quote) {
        const close = tag.indexOf(quote, i + 1);
        const stop = close < 0 || close > end ? end : close;
        value = tag.slice(i + 1, stop);
        i = stop + 1;
      } else {
        const valueStart = i;
        while (i < end && !isSpace(tag[i])) i++;
        value = tag.slice(valueStart, i);
      }
    }
    if (name && !attributes.has(name)) attributes.set(name, value);
    if (i === nameStart) i++; // 進まない文字（壊れた形）で止まらないように1字進める
  }
  return attributes;
};

/**
 * 本文から og:image / twitter:image の値を1つ取る。**先頭から1度だけ読み進める**（安全-04）:
 * `<` を1つずつ探し、`meta` で始まるものだけ、次の `>` までをタグ1つぶんとして切り出して読む。
 * 閉じの `>` が無ければそこで終わる。長すぎるタグは読まずに飛ばす。どの文字も定数回しか見ない。
 * ⚠️ Workers の HTMLRewriter は検査の環境（Node）に無いので使わない（指摘の第一候補から、第二の形にした・AI判断）。
 */
const extractImageUrl = (html: string): string | null => {
  let from = 0;
  for (;;) {
    const start = html.indexOf("<", from);
    if (start < 0) return null;
    from = start + 1;
    if (html.slice(start + 1, start + 5).toLowerCase() !== "meta" || !isSpace(html[start + 5] ?? ">")) continue;
    const close = html.indexOf(">", start);
    if (close < 0) return null;
    from = close + 1;
    if (close - start > MAX_META_TAG_CHARS) continue;
    const attributes = readAttributes(html.slice(start, close + 1));
    const key = (attributes.get("property") ?? attributes.get("name") ?? "").trim().toLowerCase();
    const content = attributes.get("content")?.trim();
    if (IMAGE_META_KEYS.has(key) && content) return content;
  }
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
  accept: string,
): Promise<{ response: Response; finalUrl: URL } | null> => {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isSafeUrl(current)) return null;
    let response: Response;
    try {
      response = await fetchImpl(current.toString(), { redirect: "manual", signal, headers: { accept } });
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
      const followed = await fetchSafely(base, fetchImpl, opts.signal, "text/html");
      if (!followed || !followed.response.ok) return { ok: false };

      const html = await readLimitedText(followed.response, MAX_HTML_BYTES);
      const rawImageUrl = extractImageUrl(html);
      if (!rawImageUrl) return { ok: false };

      const imageUrl = resolveAbsoluteUrl(rawImageUrl, followed.finalUrl.toString());
      if (!imageUrl || !isSafeUrl(imageUrl)) return { ok: false };

      // 画像も同じ検査をしながら取りに行く（リダイレクトの行き先ごとに内部アドレスを断る）。
      const fetched = await fetchSafely(imageUrl, fetchImpl, opts.signal, "image/*");
      if (!fetched || !fetched.response.ok) return { ok: false };
      const { bytes, overflowed } = await readLimitedBytes(fetched.response, STORE_IMAGE_MAX_BYTES);
      if (overflowed) return { ok: false };
      const contentType = detectImageType(bytes);
      if (!contentType) return { ok: false };

      return { ok: true, image: { body: bytes, contentType } };
    } catch {
      // 打ち切り（AbortError）・通信の失敗のどれも「取れなかった」。
      return { ok: false };
    }
  },
});
