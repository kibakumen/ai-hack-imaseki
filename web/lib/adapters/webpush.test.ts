// プッシュの送信の実物（受け入れ検査は偽物に差し替えるので、ここだけが実物の振る舞いを見る）。
// 見るのは5つ: 送る先と見出し／本文が空（中身を載せない）／署名が公開の側で検証できる／
// 「もう無い」の見分け（404・410）／通信の失敗と壊れた購読。
import { describe, expect, it } from "vitest";
import { createPushSender } from "./webpush";

/** web-push generate-vapid-keys と同じ形（公開＝65バイトの点・秘密＝32バイト、どちらも base64url）の鍵を作る。 */
const generateKeys = async (): Promise<{ publicKey: string; privateKey: string; verifyKey: CryptoKey }> => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const toBase64Url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { publicKey: toBase64Url(raw), privateKey: jwk.d as string, verifyKey: pair.publicKey };
};

const SUBSCRIPTION = { endpoint: "https://push.example.test/sub/1", keys: { p256dh: "BPUB", auth: "AUTH" } };

type Call = { url: string; init: RequestInit };
const recordingFetch = (respond: () => Response): { calls: Call[]; impl: typeof globalThis.fetch } => {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return respond();
  }) as unknown as typeof globalThis.fetch;
  return { calls, impl };
};

const base64UrlToBytes = (value: string): Uint8Array => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
};

describe("adapters/webpush", () => {
  it("購読の配信元へ本文なしで POST し、TTL と VAPID の見出しを付ける。中身（客のデータ）は1バイトも乗らない", async () => {
    const keys = await generateKeys();
    const { calls, impl } = recordingFetch(() => new Response(null, { status: 201 }));
    const sender = createPushSender({ publicKey: keys.publicKey, privateKey: keys.privateKey, contactEmail: null, fetch: impl });
    expect(await sender.send(SUBSCRIPTION, { ttlSeconds: 1200 })).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(SUBSCRIPTION.endpoint);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body ?? null).toBeNull();
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.ttl).toBe("1200");
    expect(headers.authorization).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${keys.publicKey}$`));
    expect(JSON.stringify(calls[0].init)).not.toContain("BPUB");
  });

  it("署名は公開の側で検証でき、aud は配信元・sub は連絡先（無ければ URL）・exp は先の時刻", async () => {
    const keys = await generateKeys();
    const { calls, impl } = recordingFetch(() => new Response(null, { status: 201 }));
    const now = () => new Date("2026-09-22T06:00:00.000Z").getTime();
    const sender = createPushSender({ publicKey: keys.publicKey, privateKey: keys.privateKey, contactEmail: "admin@example.com", fetch: impl, now });
    await sender.send(SUBSCRIPTION, { ttlSeconds: 1200 });
    const jwt = (calls[0].init.headers as Record<string, string>).authorization.slice("vapid t=".length).split(", k=")[0];
    const [head, payload, signature] = jwt.split(".");
    const verified = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, keys.verifyKey, base64UrlToBytes(signature), new TextEncoder().encode(`${head}.${payload}`));
    expect(verified).toBe(true);
    expect(JSON.parse(new TextDecoder().decode(base64UrlToBytes(head)))).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as { aud: string; sub: string; exp: number };
    expect(claims.aud).toBe("https://push.example.test");
    expect(claims.sub).toBe("mailto:admin@example.com");
    expect(claims.exp).toBe(Math.floor(now() / 1000) + 12 * 60 * 60);
    const withoutContact = createPushSender({ publicKey: keys.publicKey, privateKey: keys.privateKey, fetch: impl, now });
    await withoutContact.send(SUBSCRIPTION, { ttlSeconds: 1200 });
    const second = (calls[1].init.headers as Record<string, string>).authorization.slice("vapid t=".length).split(", k=")[0].split(".")[1];
    expect((JSON.parse(new TextDecoder().decode(base64UrlToBytes(second))) as { sub: string }).sub).toMatch(/^https:\/\//);
  });

  it("404 と 410 は「もう無い」。ほかの失敗・通信の失敗は「もう無い」ではない", async () => {
    const keys = await generateKeys();
    const sender = (respond: () => Response) => createPushSender({ publicKey: keys.publicKey, privateKey: keys.privateKey, fetch: recordingFetch(respond).impl });
    expect(await sender(() => new Response(null, { status: 404 })).send(SUBSCRIPTION, { ttlSeconds: 1200 })).toEqual({ ok: false, gone: true });
    expect(await sender(() => new Response(null, { status: 410 })).send(SUBSCRIPTION, { ttlSeconds: 1200 })).toEqual({ ok: false, gone: true });
    expect(await sender(() => new Response(null, { status: 500 })).send(SUBSCRIPTION, { ttlSeconds: 1200 })).toEqual({ ok: false, gone: false });
    const failing = createPushSender({
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      fetch: (() => Promise.reject(new TypeError("offline"))) as unknown as typeof globalThis.fetch,
    });
    expect(await failing.send(SUBSCRIPTION, { ttlSeconds: 1200 })).toEqual({ ok: false, gone: false });
  });

  it("配信元の URL を持たない購読は、送らずに「もう無い」（次から呼ばれないように消させる）", async () => {
    const keys = await generateKeys();
    const { calls, impl } = recordingFetch(() => new Response(null, { status: 201 }));
    const sender = createPushSender({ publicKey: keys.publicKey, privateKey: keys.privateKey, fetch: impl });
    expect(await sender.send({ keys: { p256dh: "x", auth: "y" } }, { ttlSeconds: 1200 })).toEqual({ ok: false, gone: true });
    expect(await sender.send(null, { ttlSeconds: 1200 })).toEqual({ ok: false, gone: true });
    expect(calls).toHaveLength(0);
  });

  it("鍵の形が違えば、落ちずに「送れなかった」と答える", async () => {
    const { calls, impl } = recordingFetch(() => new Response(null, { status: 201 }));
    const sender = createPushSender({ publicKey: "bm90LWEta2V5", privateKey: "bm90LWEta2V5", fetch: impl });
    expect(await sender.send(SUBSCRIPTION, { ttlSeconds: 1200 })).toEqual({ ok: false, gone: false });
    expect(calls).toHaveLength(0);
  });
});
