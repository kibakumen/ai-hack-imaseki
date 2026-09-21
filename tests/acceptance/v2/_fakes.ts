// 受け入れ検査の道具: web/ の読み込み・手元の D1・偽の差し替え口・入口の呼び出し・場面の準備。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { REPO } from "./_tasks";
import type {
  AiSelectInput,
  AiSelectResult,
  AiSelector,
  CardRegistrar,
  Clock,
  Deps,
  FileStore,
  Geocoder,
  HumanCheck,
  Logger,
  PushSender,
  Rng,
} from "./_types";

export const WEB = path.join(REPO, "web");
export const ORIGIN = "https://app.test";
/** 2026-09-22 15:00 JST（06:00Z）。偽の時計の起点 */
export const T0 = "2026-09-22T06:00:00.000Z";
export const SHIBUYA = { lat: 35.6595, lng: 139.7005 };

const EARTH_R = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;
/** 検査の側の距離の式（実装と 0.5m 以内で一致することを r05 が見る） */
export const haversine = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
};
/** 起点から北へ meters 進んだ点 */
export const north = (origin: { lat: number; lng: number }, meters: number) => ({ lat: origin.lat + (meters / EARTH_R) * (180 / Math.PI), lng: origin.lng });
export const GENRES_ALL = ["和食", "寿司・海鮮", "焼肉", "焼き鳥・串", "居酒屋", "ラーメン", "そば・うどん", "中華", "イタリアン・洋食", "カレー・エスニック", "韓国料理", "カフェ・バー"];

/** `web/<rel>` を実行時に読む（型は any）。無ければ、その旨の例外 */
export const loadWeb = async <T = any>(rel: string): Promise<T> => {
  const abs = path.join(WEB, rel);
  const candidates = [abs, `${abs}.ts`, `${abs}.tsx`, path.join(abs, "index.ts")];
  const found = candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile());
  if (!found) throw new Error(`web/${rel} がありません（実装がまだ無い）`);
  return (await import(/* @vite-ignore */ pathToFileURL(found).href)) as T;
};

/** 部品（default か同名の named export）を取り出す */
export const componentOf = async (rel: string, name: string) => {
  const mod = await loadWeb(rel);
  const comp = mod[name] ?? mod.default;
  if (!comp) throw new Error(`web/${rel} に ${name} がありません`);
  return comp;
};

// ---------- 偽の時計 ----------
export type FakeClock = Clock & { advance(ms: number): Promise<void>; set(iso: string): void };
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};
export const fakeClock = (startIso = T0): FakeClock => {
  let t = new Date(startIso).getTime();
  const waiters: Array<{ at: number; resolve: () => void }> = [];
  const fire = () => {
    for (const w of [...waiters]) {
      if (w.at <= t) {
        waiters.splice(waiters.indexOf(w), 1);
        w.resolve();
      }
    }
  };
  return {
    now: () => new Date(t),
    after: (ms) => new Promise<void>((resolve) => waiters.push({ at: t + ms, resolve })),
    advance: async (ms) => {
      t += ms;
      fire();
      await flush();
    },
    set: (iso) => {
      t = new Date(iso).getTime();
      fire();
    },
  };
};
export const MIN = 60_000;
export const HOUR = 60 * MIN;

// ---------- 偽の差し替え口 ----------
export type FakeAi = AiSelector & {
  calls: AiSelectInput[];
  /** 返し方を差し替える。"hang" は永遠に返らない */
  respond: (fn: (input: AiSelectInput) => AiSelectResult | "hang" | Promise<AiSelectResult>) => void;
};
export const selectionText = (items: Array<{ storeId: string; reason: string }>) => JSON.stringify({ selections: items });
export const fakeAi = (): FakeAi => {
  let responder: (input: AiSelectInput) => AiSelectResult | "hang" | Promise<AiSelectResult> = (input) => ({
    ok: true,
    text: selectionText(input.stores.slice(0, 5).map((s) => ({ storeId: s.id, reason: `${s.genres[0] ?? "お店"}で好みに合います` }))),
    costUsd: 0.0012,
  });
  const ai: FakeAi = {
    calls: [],
    respond: (fn) => {
      responder = fn;
    },
    select: async (input, opts) => {
      ai.calls.push(JSON.parse(JSON.stringify(input)));
      const r = responder(input);
      if (r === "hang") {
        return new Promise<AiSelectResult>((resolve) => {
          opts?.signal?.addEventListener("abort", () => resolve({ ok: false, error: "aborted" }));
        });
      }
      return r;
    },
  };
  return ai;
};

export type FakeGeocoder = Geocoder & {
  calls: string[];
  set: (text: string, result: { lat: number; lng: number } | "none" | "fail" | "hang") => void;
};
export const fakeGeocoder = (): FakeGeocoder => {
  const table = new Map<string, { lat: number; lng: number } | "none" | "fail" | "hang">();
  const g: FakeGeocoder = {
    calls: [],
    set: (text, result) => {
      table.set(text, result);
    },
    geocode: async (text, opts) => {
      g.calls.push(text);
      const r = table.get(text) ?? "none";
      if (r === "none") return { ok: false };
      if (r === "fail") throw new Error("geocoder failure");
      if (r === "hang") {
        return new Promise((resolve) => {
          opts?.signal?.addEventListener("abort", () => resolve({ ok: false }));
        });
      }
      return { ok: true, lat: r.lat, lng: r.lng };
    },
  };
  return g;
};

export type FakePush = PushSender & { calls: Array<{ subscription: unknown; ttlSeconds: number }>; result: { ok: true } | { ok: false; gone: boolean } | "throw" };
export const fakePush = (): FakePush => {
  const p: FakePush = {
    calls: [],
    result: { ok: true },
    send: async (subscription, opts) => {
      p.calls.push({ subscription, ttlSeconds: opts.ttlSeconds });
      if (p.result === "throw") throw new Error("push failure");
      return p.result;
    },
  };
  return p;
};

export type FakeCard = CardRegistrar & { sessions: Map<string, string>; setupOk: boolean; confirmOk: boolean };
export const fakeCard = (): FakeCard => {
  let n = 0;
  const c: FakeCard = {
    sessions: new Map(),
    setupOk: true,
    confirmOk: true,
    createSetupSession: async ({ storeId }) => {
      if (!c.setupOk) return { ok: false };
      const sessionId = `cs_test_${++n}`;
      c.sessions.set(sessionId, storeId);
      return { ok: true, url: `https://checkout.stripe.test/${sessionId}`, sessionId };
    },
    confirmSetup: async (sessionId) => {
      const ref = c.sessions.get(sessionId);
      if (!c.confirmOk || !ref) return { ok: false };
      return { ok: true, clientReference: ref };
    },
  };
  return c;
};

export type FakeHuman = HumanCheck & { mode: "human" | "bot" | "fail" | "hang"; tokens: Array<string | null> };
export const fakeHuman = (): FakeHuman => {
  const h: FakeHuman = {
    mode: "human",
    tokens: [],
    verify: async (token, opts) => {
      h.tokens.push(token);
      if (h.mode === "fail") return { ok: false };
      if (h.mode === "hang") {
        return new Promise((resolve) => {
          opts?.signal?.addEventListener("abort", () => resolve({ ok: false }));
        });
      }
      return { ok: true, human: h.mode === "human" };
    },
  };
  return h;
};

export type FakeFiles = FileStore & { store: Map<string, { body: Uint8Array; contentType: string }> };
export const fakeFiles = (): FakeFiles => {
  const store = new Map<string, { body: Uint8Array; contentType: string }>();
  return {
    store,
    put: async (key, body, contentType) => {
      store.set(key, { body: new Uint8Array(body), contentType });
    },
    get: async (key) => store.get(key) ?? null,
    delete: async (key) => {
      store.delete(key);
    },
  };
};

export type FakeLogger = Logger & { entries: unknown[] };
export const fakeLogger = (): FakeLogger => {
  const l: FakeLogger = { entries: [], log: (entry) => l.entries.push(entry) };
  return l;
};

/** 決め打ちの乱数（コードの引き直しの検査など） */
export const fakeRng = (sequence: Uint8Array[]): Rng & { calls: number } => {
  let i = 0;
  const r = {
    calls: 0,
    bytes: (n: number) => {
      r.calls++;
      const next = sequence[Math.min(i, sequence.length - 1)];
      i++;
      const out = new Uint8Array(n);
      out.set(next.subarray(0, n));
      return out;
    },
  };
  return r;
};

// ---------- 手元の D1 ----------
export type Db = { prepare(sql: string): any; batch(stmts: any[]): Promise<any[]>; exec(sql: string): Promise<any> };
export const openDb = async (): Promise<{ db: Db; dispose: () => Promise<void> }> => {
  const { getPlatformProxy } = await import("wrangler");
  const persist = fs.mkdtempSync(path.join(os.tmpdir(), "ai-hack-v2-"));
  const proxy = await getPlatformProxy<{ DB: Db }>({ configPath: path.join(WEB, "wrangler.jsonc"), persist: { path: persist } });
  const db = proxy.env.DB;
  if (!db) throw new Error("web/wrangler.jsonc に D1 の束縛 DB がありません");
  const dir = path.join(WEB, "migrations");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = fs.readFileSync(path.join(dir, file), "utf8").replace(/--[^\n]*/g, "");
    const stmts = sql.split(";").map((s) => s.trim()).filter(Boolean);
    for (const s of stmts) await db.prepare(s).run();
  }
  return {
    db,
    dispose: async () => {
      await proxy.dispose();
      fs.rmSync(persist, { recursive: true, force: true });
    },
  };
};

export const rows = async <T = any>(db: Db, sql: string, ...params: unknown[]): Promise<T[]> => {
  const r = await db.prepare(sql).bind(...params).all();
  return r.results as T[];
};
export const one = async <T = any>(db: Db, sql: string, ...params: unknown[]): Promise<T | null> => (await rows<T>(db, sql, ...params))[0] ?? null;
export const tables = async (db: Db): Promise<string[]> =>
  (await rows<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%'")).map((r) => r.name);
/** 全部の表の中身を1つの文字列にする（前後で同じかを比べる） */
export const snapshot = async (db: Db, opts: { except?: string[] } = {}): Promise<string> => {
  const out: Record<string, unknown[]> = {};
  for (const t of (await tables(db)).sort()) {
    if (opts.except?.includes(t)) continue;
    out[t] = await rows(db, `SELECT * FROM "${t}" ORDER BY rowid`);
  }
  return JSON.stringify(out);
};
/** 全部の表の全部の行の全部の値に、ある文字列が入っていないか */
export const dbContains = async (db: Db, needle: string): Promise<boolean> => (await snapshot(db)).includes(needle);

// ---------- 入口の呼び出し ----------
export type ApiResult = { status: number; json: any; text: string; headers: Headers; setCookies: string[] };
export type Api = {
  get(path: string, init?: RequestInit): Promise<ApiResult>;
  post(path: string, body?: unknown, init?: RequestInit): Promise<ApiResult>;
  put(path: string, body?: unknown, init?: RequestInit): Promise<ApiResult>;
  patch(path: string, body?: unknown, init?: RequestInit): Promise<ApiResult>;
  del(path: string, body?: unknown, init?: RequestInit): Promise<ApiResult>;
  raw(req: Request): Promise<ApiResult>;
  cookie: string | null;
};
const setCookiesOf = (headers: Headers): string[] => {
  const h = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof h.getSetCookie === "function") return h.getSetCookie();
  const v = headers.get("set-cookie");
  return v ? [v] : [];
};
export const cookieOf = (r: ApiResult): string | null => (r.setCookies[0] ? r.setCookies[0].split(";")[0] : null);
let ipSeq = 0;
/** 呼び出し口ごとに別の接続元（連打の抑止【最終日】が接続元で数えるため。実物では Cloudflare が付ける cf-connecting-ip） */
const nextIp = () => {
  const n = ++ipSeq;
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`;
};
export const apiClient = (app: { fetch(req: Request): Promise<Response> }, cookie: string | null = null): Api => {
  const ip = nextIp();
  const raw = async (req: Request): Promise<ApiResult> => {
    const res = await app.fetch(req);
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, text, headers: res.headers, setCookies: setCookiesOf(res.headers) };
  };
  const call = (method: string) => (p: string, body?: unknown, init?: RequestInit) => {
    const headers = new Headers(init?.headers ?? {});
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    if (body !== undefined && !isForm && !headers.has("content-type")) headers.set("content-type", "application/json");
    if (method !== "GET" && !headers.has("origin")) headers.set("origin", ORIGIN);
    if (cookie && !headers.has("cookie")) headers.set("cookie", cookie);
    if (!headers.has("cf-connecting-ip")) headers.set("cf-connecting-ip", ip);
    return raw(new Request(ORIGIN + p, { ...init, method, headers, body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body) }));
  };
  return { get: (p, init) => call("GET")(p, undefined, init), post: call("POST"), put: call("PUT"), patch: call("PATCH"), del: call("DELETE"), raw, cookie };
};

// ---------- 場面（コンテキスト） ----------
export type Ctx = {
  app: { fetch(req: Request): Promise<Response>; routes: any[] };
  deps: Deps;
  db: Db;
  clock: FakeClock;
  ai: FakeAi;
  geocoder: FakeGeocoder;
  push: FakePush;
  card: FakeCard;
  human: FakeHuman;
  files: FakeFiles;
  logger: FakeLogger;
  api: (cookie?: string | null) => Api;
  /** 一部の差し替え口を替えた別の app（同じ D1） */
  withDeps: (over: Partial<Deps>) => Promise<Ctx>;
  dispose: () => Promise<void>;
  admin: { cookie: string; api: Api; email: string; password: string } | null;
};

export const makeCtx = async (opts: { clockStart?: string; deps?: Partial<Deps> } = {}): Promise<Ctx> => {
  const { db, dispose } = await openDb();
  return buildCtx(db, dispose, opts);
};

const buildCtx = async (db: Db, dispose: () => Promise<void>, opts: { clockStart?: string; deps?: Partial<Deps> }): Promise<Ctx> => {
  const clock = (opts.deps?.clock as FakeClock) ?? fakeClock(opts.clockStart);
  const ai = fakeAi();
  const geocoder = fakeGeocoder();
  const push = fakePush();
  const card = fakeCard();
  const human = fakeHuman();
  const files = fakeFiles();
  const logger = fakeLogger();
  const webcrypto = await loadWeb("lib/adapters/webcrypto");
  const deps: Deps = {
    db,
    files,
    ai,
    geocoder,
    push,
    card,
    human,
    logger,
    clock,
    rng: webcrypto.createRng(),
    hasher: webcrypto.createHasher(),
    config: { turnstileSiteKey: "site-key-test", vapidPublicKey: "vapid-public-test", contactEmail: null, orcarouterModel: "orcarouter/auto" },
    ...opts.deps,
  };
  const { createApp } = await loadWeb("lib/http/app");
  const app = createApp(deps);
  const ctx: Ctx = {
    app,
    deps,
    db,
    clock,
    ai,
    geocoder,
    push,
    card,
    human,
    files,
    logger,
    api: (cookie = null) => apiClient(app, cookie),
    withDeps: async (over) => {
      const next = await buildCtx(db, async () => {}, { deps: { ...deps, ...over } });
      next.admin = ctx.admin;
      return next;
    },
    dispose,
    admin: null,
  };
  return ctx;
};

// ---------- 場面の準備 ----------
export const CUSTOMER = { nickname: "たなか", phone: "09012345678", genres: ["和食", "居酒屋"], budgetMax: 4000 };

export const registerCustomer = async (ctx: Ctx, over: Partial<typeof CUSTOMER> & { humanToken?: string } = {}) => {
  const r = await ctx.api().post("/api/register/customer", { ...CUSTOMER, humanToken: "tok-ok", ...over });
  if (![200, 201].includes(r.status)) throw new Error(`客の登録に失敗: ${r.status} ${r.text}`);
  const cookie = cookieOf(r);
  if (!cookie) throw new Error("客の登録の応答に Set-Cookie がありません");
  return { cookie, api: ctx.api(cookie), response: r };
};

export const seedAdmin = async (ctx: Ctx, input: { email?: string; password?: string } = {}) => {
  const email = input.email ?? "admin@example.com";
  const password = input.password ?? "admin-pass-1234";
  const { seedAdmin: seed } = await loadWeb("lib/usecases/seedAdmin");
  await seed(ctx.deps, { email, password });
  const r = await ctx.api().post("/api/auth/login", { email, password, humanToken: "tok-ok" });
  if (r.status !== 200) throw new Error(`運営のログインに失敗: ${r.status} ${r.text}`);
  const cookie = cookieOf(r)!;
  const admin = { cookie, api: ctx.api(cookie), email, password };
  ctx.admin = admin;
  return admin;
};

let storeSeq = 0;
export const registerStore = async (ctx: Ctx, over: { name?: string; email?: string; password?: string; humanToken?: string } = {}) => {
  const n = ++storeSeq;
  const input = { name: over.name ?? `店${n}`, email: over.email ?? `store${n}-${Date.now()}@example.com`, password: over.password ?? "store-pass-1234", humanToken: over.humanToken ?? "tok-ok" };
  const r = await ctx.api().post("/api/register/store", input);
  if (![200, 201].includes(r.status)) throw new Error(`店の登録に失敗: ${r.status} ${r.text}`);
  let cookie = cookieOf(r);
  if (!cookie) {
    const l = await ctx.api().post("/api/auth/login", { email: input.email, password: input.password, humanToken: "tok-ok" });
    cookie = cookieOf(l);
  }
  if (!cookie) throw new Error("店のセッションの Cookie が取れません");
  const api = ctx.api(cookie);
  const home = await api.get("/api/store/home");
  if (home.status !== 200) throw new Error(`店のホームが取れません: ${home.status} ${home.text}`);
  return { cookie, api, id: home.json.id as string, ...input };
};

export type StoreProfile = { name: string; address: string; url: string | null; genres: string[]; menus: string[]; budgetMin: number; budgetMax: number };
export const PROFILE: StoreProfile = { name: "店", address: "東京都渋谷区道玄坂1-1", url: "https://example.com/store", genres: ["和食"], menus: ["刺身盛り", "焼き魚定食"], budgetMin: 2000, budgetMax: 4000 };

export const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, ...new Array(64).fill(0x20)]);
export const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, ...new Array(64).fill(0x00)]);
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(64).fill(0x00)]);
export const GIF_BYTES = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, ...new Array(64).fill(0x00)]);

export const uploadLicense = async (api: Api, bytes: Uint8Array, name = "license.pdf", type = "application/pdf") => {
  const fd = new FormData();
  fd.append("file", new File([bytes], name, { type }));
  return api.post("/api/store/license", fd);
};

export const registerCard = async (api: Api) => {
  const setup = await api.post("/api/store/card/setup", {});
  if (setup.status !== 200) throw new Error(`カードの登録の開始に失敗: ${setup.status} ${setup.text}`);
  const url: string = setup.json.url;
  const sessionId = url.split("/").pop()!;
  const confirm = await api.post("/api/store/card/confirm", { sessionId });
  if (confirm.status !== 200) throw new Error(`カードの登録の確かめに失敗: ${confirm.status} ${confirm.text}`);
  return confirm;
};

/** 承認済みの店を1つ作る（登録→店の情報→許可書→カード→運営が承認） */
export const approvedStore = async (
  ctx: Ctx,
  over: Partial<StoreProfile> & { lat?: number; lng?: number; coupons?: Array<{ name: string; note: string }>; email?: string; password?: string } = {},
) => {
  if (!ctx.admin) await seedAdmin(ctx);
  const store = await registerStore(ctx, { name: over.name, email: over.email, password: over.password });
  const profile: StoreProfile = { ...PROFILE, ...over, name: over.name ?? store.name, address: over.address ?? `${PROFILE.address}-${store.id}` };
  ctx.geocoder.set(profile.address, { lat: over.lat ?? SHIBUYA.lat, lng: over.lng ?? SHIBUYA.lng });
  const p = await store.api.put("/api/store/profile", profile);
  if (p.status !== 200) throw new Error(`店の情報の保存に失敗: ${p.status} ${p.text}`);
  const lic = await uploadLicense(store.api, PDF_BYTES);
  if (![200, 201].includes(lic.status)) throw new Error(`許可書の登録に失敗: ${lic.status} ${lic.text}`);
  await registerCard(store.api);
  const coupons: Array<{ id: string; name: string; note: string }> = [];
  for (const c of over.coupons ?? []) {
    const r = await store.api.post("/api/store/coupons", c);
    if (![200, 201].includes(r.status)) throw new Error(`クーポンの作成に失敗: ${r.status} ${r.text}`);
    coupons.push(r.json.coupon);
  }
  const a = await ctx.admin!.api.post(`/api/admin/stores/${store.id}/approve`, {});
  if (a.status !== 200) throw new Error(`承認に失敗: ${a.status} ${a.text}`);
  return { ...store, profile, coupons };
};

export const publishOffer = async (api: Api, over: { couponIds?: string[]; capacity?: number; partyMax?: number; until?: string } = {}) => {
  const r = await api.post("/api/store/offers", { couponIds: [], capacity: 3, partyMax: 4, until: "23:00", ...over });
  if (![200, 201].includes(r.status)) throw new Error(`公開に失敗: ${r.status} ${r.text}`);
  return r.json.offer as { id: string; capacity: number; remaining: number; partyMax: number; untilAt: string; publishedAt: string };
};

export const fetchOffers = async (api: Api, over: { lat?: number; lng?: number; place?: string; party?: number; genres?: string[]; budgetMax?: number | null } = {}) => {
  const body: any = { party: 2, genres: [], budgetMax: null, ...over };
  if (!over.place) {
    body.lat = over.lat ?? SHIBUYA.lat;
    body.lng = over.lng ?? SHIBUYA.lng;
  }
  return api.post("/api/customer/fetch", body);
};

export const receive = async (api: Api, input: { offerId: string; party: number; fetchId: string }) => api.post("/api/customer/reservations", input);

/** 客1人が受け取りまで済ませた場面 */
export const receivedScene = async (ctx: Ctx, over: { capacity?: number; partyMax?: number; party?: number; coupons?: Array<{ name: string; note: string }>; storeName?: string } = {}) => {
  const store = await approvedStore(ctx, { name: over.storeName ?? "受け取りの店", coupons: over.coupons ?? [] });
  const offer = await publishOffer(store.api, { capacity: over.capacity ?? 3, partyMax: over.partyMax ?? 4, couponIds: store.coupons.map((c) => c.id) });
  const customer = await registerCustomer(ctx);
  const f = await fetchOffers(customer.api, { party: over.party ?? 2 });
  if (f.status !== 200) throw new Error(`取得に失敗: ${f.status} ${f.text}`);
  const r = await receive(customer.api, { offerId: offer.id, party: over.party ?? 2, fetchId: f.json.fetchId });
  if (r.status !== 200) throw new Error(`受け取りに失敗: ${r.status} ${r.text}`);
  return { store, offer, customer, reservation: r.json.reservation as { id: string; code: string }, fetchId: f.json.fetchId as string };
};

// ---------- 画面の検査（jsdom）用の偽の fetch ----------
export type FakeRoute = (input: { method: string; path: string; body: any; url: URL }) => { status?: number; json?: unknown } | Promise<{ status?: number; json?: unknown }>;
export type FakeApi = { calls: Array<{ method: string; path: string; body: any }>; on: (method: string, path: string, handler: FakeRoute) => void; restore: () => void };
/** 画面の部品の検査で、client/api が呼ぶ fetch を偽物にする */
export const installFakeApi = (routes: Record<string, FakeRoute> = {}): FakeApi => {
  const table = new Map<string, FakeRoute>(Object.entries(routes));
  const prev = globalThis.fetch;
  const calls: FakeApi["calls"] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    let body: any = null;
    const raw = init?.body ?? (input instanceof Request ? await input.text() : undefined);
    if (typeof raw === "string") {
      try {
        body = JSON.parse(raw);
      } catch {
        body = raw;
      }
    } else if (raw) body = raw;
    calls.push({ method, path: url.pathname, body });
    const handler = table.get(`${method} ${url.pathname}`) ?? [...table.entries()].find(([k]) => matchRoute(k, method, url.pathname))?.[1];
    if (!handler) return new Response(JSON.stringify({ ok: false, error: { kind: "not_found" } }), { status: 404, headers: { "content-type": "application/json" } });
    const out = await handler({ method, path: url.pathname, body, url });
    return new Response(JSON.stringify(out.json ?? { ok: true }), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return {
    calls,
    on: (method, path, handler) => {
      table.set(`${method.toUpperCase()} ${path}`, handler);
    },
    restore: () => {
      globalThis.fetch = prev;
    },
  };
};
const matchRoute = (key: string, method: string, pathname: string) => {
  const [m, p] = key.split(" ");
  if (m !== method) return false;
  const re = new RegExp(`^${p.replace(/:[^/]+/g, "[^/]+")}$`);
  return re.test(pathname);
};

export const invalidInput = (fields: Array<{ name: string; reason: string }>) => ({ status: 400, json: { ok: false, error: { kind: "invalid_input", fields } } });
export const refusal = (kind: string, extra: Record<string, unknown> = {}) => ({ status: 409, json: { ok: false, error: { kind, ...extra } } });

export const homeFetch = (over: Partial<import("./_types").HomeDto> = {}): import("./_types").HomeDto => ({ kind: "fetch", profile: { ...CUSTOMER }, ...over });
export const reservationDto = (over: Partial<import("./_types").ReservationDto> = {}): import("./_types").ReservationDto => ({
  id: "res-1",
  code: "12345678",
  storeId: "store-1",
  storeName: "受け取りの店",
  storeAddress: "東京都渋谷区道玄坂1-1",
  storeUrl: "https://example.com/store",
  party: 2,
  expiresAt: new Date(Date.now() + 20 * MIN).toISOString(),
  status: "active",
  coupons: [{ name: "生ビール1杯", note: "1組1回" }],
  ...over,
});
export const storeHomeDto = (over: Partial<import("./_types").StoreHomeDto> = {}): import("./_types").StoreHomeDto => ({
  id: "store-1",
  status: "approved",
  checklist: { license: true, card: true },
  missingProfile: [],
  offer: null,
  publishPrefill: { couponIds: [], capacity: null, partyMax: null, until: null },
  coupons: [],
  arrivals: [],
  ...over,
});
export const offerDto = (over: Partial<import("./_types").OfferDto> = {}): import("./_types").OfferDto => ({
  id: "offer-1",
  capacity: 3,
  remaining: 2,
  partyMax: 4,
  untilAt: "2026-09-22T08:00:00.000Z",
  publishedAt: "2026-09-22T06:00:00.000Z",
  coupons: [],
  latestUntil: "2026-09-22T18:00:00.000Z",
  ...over,
});
