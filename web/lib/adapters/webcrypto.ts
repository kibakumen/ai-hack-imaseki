// Rng と Hasher の実物。乱数・SHA-256・PBKDF2 のために crypto を呼ぶ、ただ1つの場所
// （設計書「依存の向き」の注: crypto を呼ぶのは lib/adapters だけ）。Web Crypto API は
// Cloudflare Workers にも Node にも在る（受け入れ検査でも実物を使う・確実）。

import type { Hasher, Rng } from "../ports";

const webcrypto = (): Crypto => {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("Web Crypto API が使えません（globalThis.crypto.subtle が無い）");
  return c;
};

const toHex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};

const base64ToBytes = (b64: string): Uint8Array => {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
};

/** 乱数（客の識別子・受け取りのコード・パスワードの塩などに使う）。 */
export const createRng = (): Rng => ({
  bytes: (n: number) => {
    const out = new Uint8Array(n);
    webcrypto().getRandomValues(out);
    return out;
  },
});

/** SHA-256（Cookie の値・セッションの値を探す鍵）と PBKDF2-SHA256（パスワード）。 */
export const createHasher = (): Hasher => ({
  sha256Hex: async (input: string) => {
    const digest = await webcrypto().subtle.digest("SHA-256", new TextEncoder().encode(input));
    return toHex(digest);
  },
  derive: async (password: string, saltB64: string, iterations: number) => {
    const subtle = webcrypto().subtle;
    const keyMaterial = await subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await subtle.deriveBits({ name: "PBKDF2", salt: base64ToBytes(saltB64), iterations, hash: "SHA-256" }, keyMaterial, 256);
    return bytesToBase64(new Uint8Array(bits));
  },
});
