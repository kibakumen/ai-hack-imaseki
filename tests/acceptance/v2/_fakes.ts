// 受け入れ検査の道具: web/ の読み込み・手元の D1・偽の差し替え口・入口の呼び出し・場面の準備。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { REPO } from "./_tasks";
import type { Deps } from "./_types";
import {
  cardOfCheckout,
  fakeAi,
  fakeCard,
  fakeClock,
  fakeFiles,
  fakeGeocoder,
  fakeHuman,
  fakeLogger,
  fakePitch,
  fakePush,
  fakeStoreImage,
  isFake,
  MIN,
  type FakeAi,
  type FakeCard,
  type FakeClock,
  type FakeFiles,
  type FakeGeocoder,
  type FakeHuman,
  type FakeLogger,
  type FakePitch,
  type FakePush,
  type FakeStoreImage,
} from "./_fakePorts";

export * from "./_fakePorts";

export const WEB = path.join(REPO, "web");
export const ORIGIN = "https://app.test";
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

// ---------- 手元の D1 ----------
export type Db = { prepare(sql: string): any; batch(stmts: any[]): Promise<any[]>; exec(sql: string): Promise<any> };
/**
 * SQL の文を1つずつに分ける。行の注（`--`）を落とし、文字列の中の `;` と、トリガーの本文
 * （`BEGIN … END`）の中の `;` では切らない。
 */
export const splitSql = (sql: string): string[] => {
  const out: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let depth = 0;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      current += "\n";
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    if (/[A-Za-z_]/.test(ch) && !/[A-Za-z0-9_]/.test(sql[i - 1] ?? "")) {
      const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(i))![0].toUpperCase();
      if (word === "BEGIN" && /\bTRIGGER\b/i.test(current)) depth++;
      else if (word === "CASE" && depth > 0) depth++;
      else if (word === "END" && depth > 0) depth--;
    }
    if (ch === ";" && depth === 0) {
      if (current.trim()) out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
};
/**
 * `web/migrations/*.sql` を番号順に流す。**migration を流す道具はここ1つ**（2026-09-25 設計-19）——
 * 以前は同じ `split(";")` が3か所に写されていて、`;` を含む文やトリガーを足すと写しのどれかだけが壊れた。
 * web/ の単体の検査も `openDb` かこの関数を使う。
 */
export const applyMigrations = async (db: Db): Promise<void> => {
  const dir = path.join(WEB, "migrations");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const statement of splitSql(fs.readFileSync(path.join(dir, file), "utf8"))) await db.prepare(statement).run();
  }
};
export const openDb = async (): Promise<{ db: Db; dispose: () => Promise<void> }> => {
  const { getPlatformProxy } = await import("wrangler");
  const persist = fs.mkdtempSync(path.join(os.tmpdir(), "ai-hack-v2-"));
  const proxy = await getPlatformProxy<{ DB: Db }>({ configPath: path.join(WEB, "wrangler.jsonc"), persist: { path: persist } });
  const db = proxy.env.DB;
  if (!db) throw new Error("web/wrangler.jsonc に D1 の束縛 DB がありません");
  await applyMigrations(db);
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
type Send = (path: string, body?: unknown, init?: RequestInit) => Promise<ApiResult>;
export type Api = {
  get(path: string, init?: RequestInit): Promise<ApiResult>;
  post: Send;
  put: Send;
  patch: Send;
  /** DELETE。HTTP の方法の名前（小文字）でも引けるように `delete` も同じもの（r29 が `api[method.toLowerCase()]` で引く） */
  del: Send;
  delete: Send;
  raw(req: Request): Promise<ApiResult>;
  /** 本文を読まずに応答そのものを返す（少しずつ届く入口を1行ずつ読むため） */
  open(method: string, path: string, body?: unknown, init?: RequestInit): Promise<Response>;
  cookie: string | null;
  /** この呼び出し口の接続元（cf-connecting-ip） */
  ip: string;
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
/**
 * 入口を呼ぶ口。接続元は既定で呼び出し口ごとに別（`opts.ip` で指定できる——同じ接続元から
 * 何人もが送る場面や、連打の抑止を接続元で数える検査のため・2026-09-25 設計-04）。
 */
export const apiClient = (app: { fetch(req: Request): Promise<Response> }, cookie: string | null = null, opts: { ip?: string } = {}): Api => {
  const ip = opts.ip ?? nextIp();
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
  const request = (method: string, p: string, body?: unknown, init?: RequestInit): Request => {
    const headers = new Headers(init?.headers ?? {});
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    if (body !== undefined && !isForm && !headers.has("content-type")) headers.set("content-type", "application/json");
    if (method !== "GET" && !headers.has("origin")) headers.set("origin", ORIGIN);
    if (cookie && !headers.has("cookie")) headers.set("cookie", cookie);
    if (!headers.has("cf-connecting-ip")) headers.set("cf-connecting-ip", ip);
    return new Request(ORIGIN + p, { ...init, method, headers, body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body) });
  };
  const call = (method: string): Send => (p, body, init) => raw(request(method, p, body, init));
  const del = call("DELETE");
  return {
    get: (p, init) => call("GET")(p, undefined, init),
    post: call("POST"),
    put: call("PUT"),
    patch: call("PATCH"),
    del,
    delete: del,
    raw,
    open: (method, p, body, init) => app.fetch(request(method, p, body, init)),
    cookie,
    ip,
  };
};

// ---------- 場面（コンテキスト） ----------
/** 場面の手元に置く偽物の道具（`ctx.<名前>`）。どれも app に渡った差し替え口そのもの */
type FakeTools = {
  clock: FakeClock;
  ai: FakeAi;
  pitch: FakePitch;
  geocoder: FakeGeocoder;
  storeImage: FakeStoreImage;
  push: FakePush;
  card: FakeCard;
  human: FakeHuman;
  files: FakeFiles;
  logger: FakeLogger;
};
type ToolName = keyof FakeTools;
const TOOL_NAMES: readonly ToolName[] = ["clock", "ai", "pitch", "geocoder", "storeImage", "push", "card", "human", "files", "logger"];

/**
 * 差し替え口の一部を替えた場面。**替えた口が偽物でなければ、その欄の偽物の道具は無い**——型の上でも
 * 実行時にも undefined（2026-09-25 設計-02 のレビュー。以前は `deps.logger as FakeLogger` と型だけ偽物にしていて、
 * 偽物でない Logger を渡すと、型は FakeLogger なのに `.entries` が実行時に黙って undefined だった）。
 * 替えなかった口は親と同じ偽物。`CtxWith<{}>`（何も替えない）＝ `Ctx`。
 */
export type CtxWith<O extends Partial<Deps> = {}> = {
  app: { fetch(req: Request): Promise<Response>; routes: any[] };
  deps: Deps;
  db: Db;
  api: (cookie?: string | null, opts?: { ip?: string }) => Api;
  /**
   * 一部の差し替え口を替えた別の app（同じ D1）。替えなかった口は**親と同じ偽物**で、
   * `next.geocoder === next.deps.geocoder` のように、場面の手元の偽物と app に渡る偽物が常に同じ物になる。
   * 替えた口は、渡した物が偽物ならそれが `next.<名前>` になり、偽物でなければ `next.<名前>` は undefined。
   */
  withDeps: <P extends Partial<Deps>>(over: P) => Promise<CtxWith<Omit<O, keyof P> & P>>;
  dispose: () => Promise<void>;
  admin: { cookie: string; api: Api; email: string; password: string } | null;
} & { [K in ToolName]: K extends keyof O ? (O[K] extends FakeTools[K] ? FakeTools[K] : undefined) : FakeTools[K] };
/** 差し替え口が全部偽物の場面（makeCtx() の既定） */
export type Ctx = CtxWith;

export const makeCtx = async <O extends Partial<Deps> = {}>(opts: { clockStart?: string; deps?: O } = {}): Promise<CtxWith<O>> => {
  const { db, dispose } = await openDb();
  return buildCtx<O>(db, dispose, opts);
};

/**
 * 場面を組む。渡された口（opts.deps）があればそれを使い、無い口だけ新しい偽物を作る。
 * **場面の手元の偽物（ctx.geocoder など）と、app に渡る偽物（ctx.deps.geocoder）は常に同じ物**
 * （2026-09-25 設計-02。以前は withDeps が新しい偽物を ctx に置きながら app には親の偽物を渡していて、
 * `ctx.geocoder.set(…)` がどこにも繋がらず d01 の場面が作れなかった）。
 */
const buildCtx = async <O extends Partial<Deps>>(db: Db, dispose: () => Promise<void>, opts: { clockStart?: string; deps?: O }): Promise<CtxWith<O>> => {
  const given: Partial<Deps> = opts.deps ?? {};
  const webcrypto = await loadWeb("lib/adapters/webcrypto");
  const deps: Deps = {
    db,
    files: given.files ?? fakeFiles(),
    ai: given.ai ?? fakeAi(),
    pitch: "pitch" in given ? given.pitch : fakePitch(),
    geocoder: given.geocoder ?? fakeGeocoder(),
    storeImage: "storeImage" in given ? given.storeImage : fakeStoreImage(),
    push: given.push ?? fakePush(),
    card: given.card ?? fakeCard(),
    human: given.human ?? fakeHuman(),
    // メールを送る口は既定では持たない（鍵を入れていない公開先と同じ）。渡されたときだけ置く（2026-09-26 取り込み）
    ...("mailer" in given ? { mailer: given.mailer } : {}),
    logger: given.logger ?? fakeLogger(),
    clock: given.clock ?? fakeClock(opts.clockStart),
    rng: given.rng ?? webcrypto.createRng(),
    hasher: given.hasher ?? webcrypto.createHasher(),
    config: given.config ?? { turnstileSiteKey: "site-key-test", vapidPublicKey: "vapid-public-test", contactEmail: null, orcarouterModel: "orcarouter/auto" },
  };
  const { createApp } = await loadWeb("lib/http/app");
  const app = createApp(deps);
  // 手元の道具は、app に渡した物そのもの。偽物でない物が渡った口は undefined（型の CtxWith と同じ読み）
  const tools = Object.fromEntries(TOOL_NAMES.map((name) => [name, isFake(deps[name]) ? deps[name] : undefined]));
  const ctx = {
    app,
    deps,
    db,
    ...tools,
    api: (cookie: string | null = null, apiOpts: { ip?: string } = {}) => apiClient(app, cookie, apiOpts),
    withDeps: async (over: Partial<Deps>) => {
      const next = await buildCtx(db, async () => {}, { deps: { ...deps, ...over } });
      next.admin = ctx.admin;
      return next;
    },
    dispose,
    admin: null,
  } as unknown as CtxWith<O>;
  return ctx;
};

// ---------- 場面の準備 ----------
// 場面の道具は、使う欄だけを受け取る（差し替え口を替えた場面 CtxWith も、使う偽物が揃っていれば渡せる。
// 使う偽物を偽物でない物に替えた場面は、型の検査で弾かれる）
/** 入口を呼べる場面 */
type ApiScene = Pick<Ctx, "api">;
/** 運営を作れる場面 */
type AdminScene = Pick<Ctx, "api" | "deps" | "admin">;
/** 承認済みの店を作れる場面（店の住所を偽の地図に置くので、偽の地図が要る） */
type StoreScene = Pick<Ctx, "api" | "deps" | "admin" | "geocoder">;
export const CUSTOMER = { nickname: "たなか", phone: "09012345678", genres: ["和食", "居酒屋"], budgetMax: 4000 };

export const registerCustomer = async (ctx: ApiScene, over: Partial<typeof CUSTOMER> & { humanToken?: string } = {}) => {
  const r = await ctx.api().post("/api/register/customer", { ...CUSTOMER, humanToken: "tok-ok", ...over });
  if (![200, 201].includes(r.status)) throw new Error(`客の登録に失敗: ${r.status} ${r.text}`);
  const cookie = cookieOf(r);
  if (!cookie) throw new Error("客の登録の応答に Set-Cookie がありません");
  return { cookie, api: ctx.api(cookie), response: r };
};

export const seedAdmin = async (ctx: AdminScene, input: { email?: string; password?: string } = {}) => {
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

/**
 * 店の登録で送る「同意した店向けの利用規約の版」（2026-09-25 監査の指摘 店-21 のレビュー）。入口は今の版と一致しない
 * 登録を断り、通った登録は版と同意の時刻を残す。版は入口と画面の正本（web/lib/schemas/limits の STORE_TERMS_VERSION）と同じ値
 * ——ずれたら web/lib/schemas/storeTermsVersion.test.ts が落ちる（規約の版を上げたら、ここも上げる）。
 */
export const STORE_TERMS_AGREEMENT = { agreedTermsVersion: "2026-09-26" } as const;

let storeSeq = 0;
export const registerStore = async (ctx: ApiScene, over: { name?: string; email?: string; password?: string; humanToken?: string } = {}) => {
  const n = ++storeSeq;
  const input = { name: over.name ?? `店${n}`, email: over.email ?? `store${n}-${Date.now()}@example.com`, password: over.password ?? "store-pass-1234", humanToken: over.humanToken ?? "tok-ok" };
  const r = await ctx.api().post("/api/register/store", { ...input, ...STORE_TERMS_AGREEMENT });
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

/**
 * 店がカードを登録する——**画面と同じ道**: 開始 → Stripe の画面で入力を終える → 戻り先（success_url）へ戻る
 * → 画面が確かめを送る。戻り先に `session_id` が載っていればそれを送り、無ければ本文なしで送る
 * （サーバーが控えた番号で確かめる形）。番号を URL から切り出すような、画面にできないことはしない。
 */
export const registerCardAsPage = async (api: Api) => {
  const setup = await api.post("/api/store/card/setup", {});
  if (setup.status !== 200) throw new Error(`カードの登録の開始に失敗: ${setup.status} ${setup.text}`);
  const checkoutUrl: string = setup.json.url;
  const back = cardOfCheckout(checkoutUrl).complete(checkoutUrl);
  const sessionId = new URL(back, ORIGIN).searchParams.get("session_id");
  const confirm = await api.post("/api/store/card/confirm", sessionId ? { sessionId } : {});
  return { checkoutUrl, back, confirm };
};

/**
 * 場面づくりのカードの登録。画面と同じ道（registerCardAsPage）だけを歩く。
 * （2026-09-25 まで、画面の道で登録済みにならない件（不具合-01）の迂回として Stripe の側の控えから番号を取っていた。
 * 不具合-01 を直したので迂回は消した——画面の道で通らなければ、場面づくりも落ちる。）
 */
export const registerCard = async (api: Api) => {
  const { confirm } = await registerCardAsPage(api);
  if (confirm.status !== 200) throw new Error(`カードの登録の確かめに失敗: ${confirm.status} ${confirm.text}`);
  return confirm;
};

/** 承認済みの店を1つ作る（登録→店の情報→許可書→カード→運営が承認） */
export const approvedStore = async (
  ctx: StoreScene,
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

const fetchBody = (over: { lat?: number; lng?: number; place?: string; party?: number; genres?: string[]; budgetMax?: number | null } = {}) => {
  const body: any = { party: 2, genres: [], budgetMax: null, ...over };
  if (!over.place) {
    body.lat = over.lat ?? SHIBUYA.lat;
    body.lng = over.lng ?? SHIBUYA.lng;
  }
  return body;
};
/** 場面の道具で行った取得 → その結果に出たオファー（受け取りの道具が、結果に出たものだけを受け取るよう見張る） */
const shownByFetch = new Map<string, string[]>();
const rememberShown = (fetchId: unknown, items: unknown) => {
  if (typeof fetchId === "string" && Array.isArray(items)) shownByFetch.set(fetchId, items.map((i: { offerId: string }) => i.offerId));
};
export const fetchOffers = async (api: Api, over: Parameters<typeof fetchBody>[0] = {}) => {
  const r = await api.post("/api/customer/fetch", fetchBody(over));
  if (r.status === 200) rememberShown(r.json?.fetchId, r.json?.items);
  return r;
};

/**
 * 受け取り（客の画面と同じ要求）。**その取得の結果に出たオファーだけ**を受け取る——場面の道具で取得した
 * fetchId に、結果に出ていないオファーを組み合わせたら、要求を送らずに落とす（2026-09-25 設計-03）。
 * 結果に無い店の受け取りの件（不具合-12）を確かめる検査のように、わざと組み合わせるときは入口を直に呼ぶ。
 */
export const receive = async (api: Api, input: { offerId: string; party: number; fetchId: string }) => {
  const shown = shownByFetch.get(input.fetchId);
  if (shown && !shown.includes(input.offerId)) {
    throw new Error(`場面の近道: 取得 ${input.fetchId} の結果に出ていないオファー ${input.offerId} を受け取ろうとしました（出たもの: ${shown.join(", ") || "なし"}）。店の場所（spot）で探してから受け取る`);
  }
  return api.post("/api/customer/reservations", input);
};

let spotSeq = 0;
/**
 * 場面ごとに別の場所（隣とは約3km＝探す範囲 800m より十分に離す）。同じ ctx に店が溜まっても、
 * その場所で探せば、その場面の店だけが候補になる（結果の順に場面が左右されない・2026-09-25 設計-03）。
 */
export const spot = (): { lat: number; lng: number } => {
  const n = ++spotSeq;
  return { lat: SHIBUYA.lat + 0.03 * ((n % 20) + 1), lng: SHIBUYA.lng + 0.03 * (Math.floor(n / 20) + 1) };
};

/** 取得の結果にそのオファーが出ていること（受け取れるのは、その取得で見せた店だけ——結果に無い店の受け取りの件（不具合-12）） */
export const requireInResults = (fetched: ApiResult, offerId: string): void => {
  if (fetched.status !== 200) throw new Error(`取得に失敗: ${fetched.status} ${fetched.text}`);
  const shown = (fetched.json.items ?? []).map((i: { offerId: string }) => i.offerId);
  if (!shown.includes(offerId)) throw new Error(`受け取るオファー ${offerId} が取得の結果に出ていません（出たもの: ${shown.join(", ") || "なし"}）。場面は結果に出たオファーだけを受け取る`);
};

/**
 * 客1人が受け取りまで済ませた場面。店は場面ごとに別の場所（spot）に置き、客はそこで探して、
 * **結果に出たことを確かめてから**受け取る（本番の客と同じ順）。`at` はその場所（続けて探す検査が使う）。
 */
export const receivedScene = async (ctx: StoreScene, over: { capacity?: number; partyMax?: number; party?: number; coupons?: Array<{ name: string; note: string }>; storeName?: string } = {}) => {
  const at = spot();
  const store = await approvedStore(ctx, { name: over.storeName ?? "受け取りの店", coupons: over.coupons ?? [], ...at });
  const offer = await publishOffer(store.api, { capacity: over.capacity ?? 3, partyMax: over.partyMax ?? 4, couponIds: store.coupons.map((c) => c.id) });
  const customer = await registerCustomer(ctx);
  const f = await fetchOffers(customer.api, { party: over.party ?? 2, ...at });
  requireInResults(f, offer.id);
  const r = await receive(customer.api, { offerId: offer.id, party: over.party ?? 2, fetchId: f.json.fetchId });
  if (r.status !== 200) throw new Error(`受け取りに失敗: ${r.status} ${r.text}`);
  return { store, offer, customer, at, reservation: r.json.reservation as { id: string; code: string }, fetchId: f.json.fetchId as string };
};

/**
 * 少しずつ届く取得の入口（本番の客の画面が使う道・NDJSON）を最後まで読む。
 * 紹介文の着手のずらしと全体の蓋は `deps.clock` で待つので、届き終わるまで偽の時計を少しずつ進める
 * （進めた分は最大で全体の蓋の 25 秒）。
 */
export const fetchOffersStream = async (ctx: Pick<Ctx, "clock">, api: Api, over: Parameters<typeof fetchBody>[0] = {}) => {
  const res = await api.open("POST", "/api/customer/fetch/stream", fetchBody(over));
  if (!(res.headers.get("content-type") ?? "").includes("ndjson") || !res.body) {
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, lines: [] as any[] };
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const lines: any[] = [];
  let buffer = "";
  let finished = false;
  const pump = (async () => {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) if (part.trim()) lines.push(JSON.parse(part));
    }
    finished = true;
  })();
  void pump.then(() => {
    const init = lines.find((l) => l.type === "init");
    if (init) rememberShown(init.fetchId, init.items);
  });
  for (let i = 0; i < 200 && !finished; i++) await ctx.clock.advance(150);
  await pump;
  return { status: res.status, json: null, lines };
};

/**
 * 約束が実時間 `ms` のうちに決まればその値、決まらなければ null（待ち続けない）。
 * 「偽の時計を進めたら応答が返る」を確かめる検査が、返らなかったときに検査の打ち切り（30秒）まで止まらないよう使う。
 */
export const settledWithin = async <T>(pending: Promise<T>, ms: number): Promise<T | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  try {
    return await Promise.race([pending, late]);
  } finally {
    clearTimeout(timer);
  }
};

/** 客の端末の Web プッシュの購読（偽物。配信先は偽の口が受けるので外へは出ない） */
export const PUSH_SUBSCRIPTION = { endpoint: "https://push.example.test/sub/1", keys: { p256dh: "BPUB", auth: "AUTH" } };

// ---------- 画面の検査（jsdom）用の偽の fetch ----------
/**
 * 少しずつ届く応答（NDJSON）。`lines` を1行ずつ送る。`holdAfter` 行を送ったら `release` を待ってから残りを送る
 * （紹介文が後から届く・遅れて届く形）。`end` は終わり方: "close"（既定）／"cut"（途中で通信が切れる）／"hang"（閉じない）。
 */
export type FakeStream = { lines: unknown[]; holdAfter?: number; release?: Promise<void>; end?: "close" | "cut" | "hang" };
export type FakeReply = { status?: number; json?: unknown; stream?: FakeStream };
export type FakeRoute = (input: { method: string; path: string; body: any; url: URL }) => FakeReply | Promise<FakeReply>;
export type FakeApi = { calls: Array<{ method: string; path: string; body: any }>; on: (method: string, path: string, handler: FakeRoute) => void; restore: () => void };

const FETCH_PATH = "/api/customer/fetch";
const FETCH_STREAM_PATH = "/api/customer/fetch/stream";
/** 取得の要求か（普通の入口と少しずつ届く入口のどちらでも1回と数える） */
export const isFetchCall = (c: { method: string; path: string }): boolean => c.method === "POST" && (c.path === FETCH_PATH || c.path === FETCH_STREAM_PATH);

/** 取得の結果を、本番の少しずつ届く入口と同じ行に直す（init → 店ごとの紹介文 → done） */
export const streamOfResult = (result: { fetchId: string; items: Array<{ storeId: string; reason: string }> }, opts: Omit<FakeStream, "lines"> = {}): FakeStream => ({
  lines: [
    { type: "init", fetchId: result.fetchId, items: result.items },
    ...result.items.map((item) => ({ type: "pitch", storeId: item.storeId, reason: item.reason, source: "persona" })),
    { type: "done" },
  ],
  ...opts,
});

const jsonResponse = (status: number, json: unknown) => new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
/** 偽の返し方を応答にする（部品の検査が自前の偽の fetch から使ってもよい） */
export const replyToResponse = (reply: FakeReply): Response => (reply.stream ? ndjsonResponse(reply.stream) : jsonResponse(reply.status ?? 200, reply.json ?? { ok: true }));
const ndjsonResponse = (s: FakeStream): Response => {
  const encoder = new TextEncoder();
  const hold = s.holdAfter ?? s.lines.length;
  let sent = 0;
  // 読む側が求めたときに1行ずつ渡す（先に全部積んでから切ると、切った時に積んだ行ごと捨てられるため）
  const body = new ReadableStream<Uint8Array>(
    {
      pull: async (controller) => {
        if (sent === hold && sent < s.lines.length) await s.release;
        if (sent < s.lines.length) {
          controller.enqueue(encoder.encode(`${JSON.stringify(s.lines[sent++])}\n`));
          return;
        }
        if (s.end === "cut") controller.error(new TypeError("network connection was lost"));
        else if (s.end === "hang") await new Promise<never>(() => {});
        else controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  return new Response(body, { status: 200, headers: { "content-type": "application/x-ndjson; charset=utf-8" } });
};

/**
 * 画面の部品の検査で、client/api が呼ぶ fetch を偽物にする。
 *
 * **取得は、少しずつ届く入口を既定にする**（2026-09-25 設計-03。本番の画面は
 * `POST /api/customer/fetch/stream` を先に使い、普通の入口へは倒れたときだけ行く）。
 * 検査が普通の入口 `POST /api/customer/fetch` の返し方だけを決めた場合は、その結果を本番と同じ行
 * （init → 紹介文 → done）にして少しずつ届く入口からも返す。普通の入口へ倒れる道を見たい検査は、
 * 少しずつ届く入口に 404 を返すよう明示する。
 */
export const installFakeApi = (routes: Record<string, FakeRoute> = {}): FakeApi => {
  const table = new Map<string, FakeRoute>(Object.entries(routes));
  const prev = globalThis.fetch;
  const calls: FakeApi["calls"] = [];
  const find = (method: string, pathname: string): FakeRoute | undefined => table.get(`${method} ${pathname}`) ?? [...table.entries()].find(([k]) => matchRoute(k, method, pathname))?.[1];
  const derivedStream: FakeRoute = async (input) => {
    const plain = find("POST", FETCH_PATH);
    if (!plain) return { status: 404, json: { ok: false, error: { kind: "not_found" } } };
    const out = await plain({ ...input, path: FETCH_PATH });
    const json = out.json as { ok?: boolean; fetchId?: string; items?: Array<{ storeId: string; reason: string }> } | undefined;
    if ((out.status ?? 200) !== 200 || !json?.ok || !json.fetchId || !Array.isArray(json.items)) return out;
    return { stream: streamOfResult({ fetchId: json.fetchId, items: json.items }) };
  };
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
    const handler = find(method, url.pathname) ?? (method === "POST" && url.pathname === FETCH_STREAM_PATH ? derivedStream : undefined);
    if (!handler) return jsonResponse(404, { ok: false, error: { kind: "not_found" } });
    return replyToResponse(await handler({ method, path: url.pathname, body, url }));
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
/**
 * 見分けの断り（401 未ログイン・ログイン切れ／403 役割違い）の応答。**形はここ1か所**（2026-09-25 設計-04。
 * 以前は入口の検査と画面の検査で3通りに食い違っていた）。入口の実物（web/lib/http/defineRoute.ts・refusals.ts）と同じ形。
 */
export const unauthorized = () => ({ status: 401, json: { ok: false, error: { kind: "unauthenticated" } } });
export const forbidden = () => ({ status: 403, json: { ok: false, error: { kind: "forbidden" } } });
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
  mustChangePassword: false,
  trend: [],
  cardSetupPending: false,
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
  untilSet: true,
  ...over,
});
