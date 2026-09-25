// Service Worker（web/public/sw.js）の振る舞い（2026-09-25 監査の指摘 不具合-05・不具合-11）。
//
// sw.js はブラウザの中でしか動かないので、`self`・`caches`・`fetch` を偽物にして読み込み、出来事を直に送る。
//   不具合-05 … どの画面の応答も /me の殻として上書き保存していた（トップ・ログイン・500 の頁が /me として出る）。
//               保存に失敗すると通信で取れた応答を捨てて古い殻を返し、古い版の保存も消さなかった。
//   不具合-11 … 購読が配信元の都合で入れ替わっても（pushsubscriptionchange）受け手が無く、作り直されなかった。

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "public", "sw.js"), "utf8");
const ORIGIN = "https://app.test";

type Handler = (event: Record<string, unknown>) => void;

/** 名前ごとに Response を持つ偽の保存先 */
const fakeCaches = (opts: { putFails?: boolean } = {}) => {
  const stores = new Map<string, Map<string, Response>>();
  const open = async (name: string) => {
    const store = stores.get(name) ?? new Map<string, Response>();
    stores.set(name, store);
    const key = (req: string | Request) => new URL(typeof req === "string" ? req : req.url, ORIGIN).pathname;
    return {
      put: async (req: string | Request, res: Response) => {
        if (opts.putFails) throw new Error("QuotaExceededError");
        store.set(key(req), res);
      },
      add: async (req: string) => {
        store.set(key(req), new Response("shell"));
      },
      match: async (req: string | Request) => store.get(key(req)),
    };
  };
  return {
    stores,
    api: {
      open,
      keys: async () => [...stores.keys()],
      delete: async (name: string) => stores.delete(name),
      match: async (req: string | Request) => {
        for (const store of stores.values()) {
          const hit = store.get(new URL(typeof req === "string" ? req : req.url, ORIGIN).pathname);
          if (hit) return hit;
        }
        return undefined;
      },
    },
  };
};

/** sw.js を読み込み、出来事を送る道具を返す */
const loadWorker = (opts: { fetch: (input: string | Request, init?: RequestInit) => Promise<Response>; putFails?: boolean; subscribe?: () => Promise<unknown> }) => {
  const handlers = new Map<string, Handler>();
  const caches = fakeCaches({ putFails: opts.putFails });
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => undefined), matchAll: async () => [], openWindow: vi.fn() },
    registration: { showNotification: vi.fn(), pushManager: { subscribe: opts.subscribe ?? vi.fn() } },
  };
  new Function("self", "caches", "fetch", "atob", SOURCE)(self, caches.api, opts.fetch, (s: string) => Buffer.from(s, "base64").toString("binary"));
  /** respondWith / waitUntil の中身を待って返す */
  const dispatch = async (type: string, event: Record<string, unknown>) => {
    let responded: Promise<Response> | undefined;
    const waits: Array<Promise<unknown>> = [];
    handlers.get(type)?.({ ...event, respondWith: (p: Promise<Response>) => (responded = p), waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
    return responded === undefined ? undefined : await responded;
  };
  return { dispatch, caches, self };
};

const navigate = (pathname: string) => ({ request: new Request(`${ORIGIN}${pathname}`, { method: "GET" }) as Request & { mode: string } });
/** jsdom でない Request は mode を持たないので、画面の移動として扱うための印を付ける */
const asNavigation = (event: { request: Request }) => {
  Object.defineProperty(event.request, "mode", { value: "navigate" });
  return event;
};

describe("sw.js の殻の保存（不具合-05）", () => {
  it("/me の画面の移動で取れた応答（2xx）だけを殻として保存し、通信が切れたらそれを返す", async () => {
    let online = true;
    const worker = loadWorker({ fetch: async () => (online ? new Response("me-page", { status: 200 }) : Promise.reject(new TypeError("offline"))) });
    const first = await worker.dispatch("fetch", asNavigation(navigate("/me")));
    expect(await first!.text()).toBe("me-page");
    online = false;
    const offline = await worker.dispatch("fetch", asNavigation(navigate("/me")));
    expect(await offline!.text()).toBe("me-page");
  });

  it("/me でない画面の移動は横取りしない（トップ・ログインを /me の殻として保存しない）", async () => {
    const worker = loadWorker({ fetch: async () => new Response("top", { status: 200 }) });
    expect(await worker.dispatch("fetch", asNavigation(navigate("/login")))).toBeUndefined();
    expect(await worker.dispatch("fetch", asNavigation(navigate("/")))).toBeUndefined();
    const shell = await worker.caches.api.match("/me");
    expect(shell).toBeUndefined();
  });

  it("/me の応答が 500 なら殻を上書きしない（前に保存した殻が残る）", async () => {
    let status = 200;
    const worker = loadWorker({ fetch: async () => new Response(status === 200 ? "good" : "error", { status }) });
    await worker.dispatch("fetch", asNavigation(navigate("/me")));
    status = 500;
    const broken = await worker.dispatch("fetch", asNavigation(navigate("/me")));
    expect(broken!.status).toBe(500);
    const shell = await worker.caches.api.match("/me");
    expect(await shell!.text()).toBe("good");
  });

  it("保存に失敗しても、通信で取れた応答をそのまま返す（古い殻へ倒さない）", async () => {
    const worker = loadWorker({ fetch: async () => new Response("fresh", { status: 200 }), putFails: true });
    const res = await worker.dispatch("fetch", asNavigation(navigate("/me")));
    expect(await res!.text()).toBe("fresh");
  });

  it("入れ替わったときに、今の版の名前でない保存を消す", async () => {
    const worker = loadWorker({ fetch: async () => new Response("x") });
    await (await worker.caches.api.open("ai-sekitori-shell-v1")).put("/me", new Response("old"));
    await (await worker.caches.api.open("ai-sekitori-assets-v1")).put("/_next/static/a.js", new Response("old"));
    await worker.dispatch("activate", {});
    expect(await worker.caches.api.keys()).not.toContain("ai-sekitori-shell-v1");
    expect(await worker.caches.api.keys()).not.toContain("ai-sekitori-assets-v1");
  });
});

describe("sw.js の購読の作り直し（不具合-11）", () => {
  it("pushsubscriptionchange で、新しい購読を入口へ預ける（新しい購読が無ければ公開値の鍵で作る）", async () => {
    const posted: unknown[] = [];
    const fetchImpl = async (input: string | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith("/api/config/public")) return new Response(JSON.stringify({ turnstileSiteKey: "s", vapidPublicKey: "dmFwaWQtQQ", contactEmail: null }), { status: 200 });
      if (url.endsWith("/api/customer/push-subscription")) {
        posted.push({ method: init?.method, body: JSON.parse(String(init?.body)) });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response("", { status: 404 });
    };
    const subscribe = vi.fn(async () => ({ toJSON: () => ({ endpoint: "https://push.example/new", keys: { p256dh: "p", auth: "a" } }) }));
    const worker = loadWorker({ fetch: fetchImpl, subscribe });
    await worker.dispatch("pushsubscriptionchange", { oldSubscription: null, newSubscription: null });
    expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
    expect(posted).toEqual([{ method: "POST", body: { subscription: { endpoint: "https://push.example/new", keys: { p256dh: "p", auth: "a" } } } }]);
  });

  it("配信元が新しい購読を渡してきたら、それをそのまま預ける（作り直さない）", async () => {
    const posted: unknown[] = [];
    const worker = loadWorker({
      fetch: async (_input, init) => {
        posted.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });
    const newSubscription = { toJSON: () => ({ endpoint: "https://push.example/given", keys: { p256dh: "p", auth: "a" } }) };
    await worker.dispatch("pushsubscriptionchange", { oldSubscription: null, newSubscription });
    expect(posted).toEqual([{ subscription: { endpoint: "https://push.example/given", keys: { p256dh: "p", auth: "a" } } }]);
  });
});
