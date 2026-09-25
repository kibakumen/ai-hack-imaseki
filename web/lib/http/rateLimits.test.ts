// 連打の抑止（要件30【最終日】）の数え方と、defineRoute に掛かっていることの検査。
//
// 受け入れ検査 r30-rate-limit.test.ts が入口を通して見るのと同じ基準を、「入口の手前の仕組み」の側から見る:
//   30.1 同じ客の取得は1分に5回／30.2 同じ接続元の登録は1時間に10回（2026-09-25 から客と店を別に数え、客は60回）／
//   30.3 同じ客の通報は1時間に5回／30.4 ログインの失敗10回で15分（メールアドレス × 接続元）／30.5 断った要求で手続きが動かない
// 数えは手元の D1（本物の SQLite）で行う。以前は rate_counters を真似た偽の Map で数えていて、
// 「読んでから書く」の2往復が同時の要求ですり抜けることを原理的に見られなかった（安全-02）。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
// 偽の時計と手元の D1 は受け入れ検査の道具を使う（写しを持たない・設計-19）。人かどうかの確かめの打ち切りは、進めないので起きない
import { fakeClock, openDb, type Db } from "../../../tests/acceptance/v2/_fakes";
import type { Deps } from "../ports";
import { rememberLoginDevice } from "../repo/loginDevices";
import {
  CUSTOMER_REGISTER_RATE_LIMIT,
  FETCH_IP_RATE_LIMIT,
  FETCH_IP_RATE_WINDOW_MS,
  FETCH_RATE_LIMIT,
  LOGIN_DEVICE_TRUST_MS,
  LOGIN_FAILURE_LIMIT,
  LOGIN_IP_FAILURE_LIMIT,
  PLACE_IP_RATE_LIMIT,
  PLACE_IP_RATE_WINDOW_MS,
  PLACE_SUGGEST_IP_RATE_LIMIT,
  PLACE_SUGGEST_IP_RATE_WINDOW_MS,
  RECEIVE_IP_RATE_LIMIT,
  RECEIVE_IP_RATE_WINDOW_MS,
  REGISTER_RATE_LIMIT,
  STORE_IMAGE_RATE_LIMIT,
} from "../schemas/limits";
import { CUSTOMER_COOKIE_NAME, LOGIN_DEVICE_COOKIE_NAME } from "./cookies";
import { defineRoute } from "./defineRoute";
import { rateKeyFor, rateLimitedRoutes, rateRuleFor, rateRulesFor } from "./rateLimits";
import { ROUTE_DEFINITIONS } from "./routes";

const ORIGIN = "https://app.test";
const T0 = "2026-09-22T06:00:00.000Z";
const MIN = 60_000;
const at = (minutes: number) => new Date(Date.parse(T0) + minutes * MIN).toISOString();

// ---------- 偽の道具（D1 だけは本物） ----------

let shared: { db: Db; dispose: () => Promise<void> };
beforeAll(async () => {
  shared = await openDb();
});
afterAll(async () => {
  await shared.dispose();
});

/** 客の Cookie の値 → 客の番号。見分けは値を SHA-256 にして引くので、偽の Hasher も同じ形で写す。 */
const hashOf = (value: string) => `sha256(${value})`;

/** 検査ごとに数えを空にし、客を入れ直す（1つの D1 を使い回すので、前の検査の数えを持ち越さない）。 */
const makeDeps = async (customers: Record<string, string> = {}) => {
  const { db } = shared;
  await db.prepare("DELETE FROM rate_counters").run();
  for (const [tokenHash, id] of Object.entries(customers)) {
    await db.prepare("INSERT OR IGNORE INTO customers (id, token_hash) VALUES (?1, ?2)").bind(id, tokenHash).run();
  }
  const clock = fakeClock(T0);
  /** 人かどうかの確かめが呼ばれた回数と、人と認めるか（false で「人でない」を返す）。 */
  const human = { calls: 0, pass: true };
  const deps = {
    db,
    clock,
    hasher: { sha256Hex: async (value: string) => hashOf(value), derive: async () => "" },
    human: {
      verify: async () => {
        human.calls++;
        return { ok: true as const, human: human.pass };
      },
    },
  } as unknown as Deps;
  const counterOf = async (key: string) => (await db.prepare("SELECT count FROM rate_counters WHERE key = ?1").bind(key).first()) as { count: number } | null;
  const counterCount = async () => Number(((await db.prepare("SELECT COUNT(*) AS n FROM rate_counters").first()) as { n: number }).n);
  return { deps, db, clock, human, counterOf, counterCount };
};

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, ...headers }, body: JSON.stringify(body) });

const jsonOf = async (res: Response) => (await res.json()) as { ok: boolean; error?: { kind?: string } };

// ---------- 外のサービスを呼ぶ入口の見つけ方（静的な走査） ----------

const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
/**
 * 外のサービスの口（地図・AI・紹介文・外への取得・Stripe・Web プッシュ）。人かどうかの確かめ（Turnstile）は
 * 手続きでなく defineRoute が呼ぶので、下で「human の入口は全部表に載っている」として別に見る。
 */
const BILLED_PORT = /\bdeps\.(geocoder|ai|pitch|storeImage|card|push)\b/;

/** ファイルの最上位の宣言（const・function）を、名前 → 本文に分ける */
const topLevelDeclarations = (text: string): Map<string, string> => {
  const starts = [...text.matchAll(/^(?:export\s+)?(?:const|(?:async\s+)?function)\s+([A-Za-z_$][\w$]*)/gm)];
  return new Map(starts.map((m, i) => [m[1], text.slice(m.index, starts[i + 1]?.index ?? text.length)]));
};
/** `import { a, b as c } from "<prefix><名前>"` を、使う名前 → 読み込み元のファイル名にする */
const namedImports = (text: string, prefix: string): Map<string, string> => {
  const out = new Map<string, string>();
  const re = new RegExp(`^import\\s+\\{([^}]*)\\}\\s+from\\s+"${prefix.replace(/[./]/g, "\\$&")}([\\w-]+)"`, "gm");
  for (const m of text.matchAll(re)) {
    for (const raw of m[1].split(",")) {
      const name = raw.trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop();
      if (name) out.set(name, m[2]);
    }
  }
  return out;
};
const calls = (body: string, name: string): boolean => new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\(`).test(body);

/**
 * usecases の関数のうち、外の口に触るもの（`<ファイル名>:<関数名>`）。同じファイルの手続きや、
 * ほかの手続きの関数を経由して触るものも含める（関数の単位で数える——同じファイルの読むだけの関数を巻き込まない）。
 */
const billedUsecaseFunctions = (): Set<string> => {
  const dir = path.join(LIB, "usecases");
  const modules = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => {
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      return { module: f.replace(/\.ts$/, ""), decls: topLevelDeclarations(text), imports: namedImports(text, "./") };
    });
  const billed = new Set<string>();
  for (let changed = true; changed; ) {
    changed = false;
    for (const { module, decls, imports } of modules) {
      for (const [name, body] of decls) {
        const key = `${module}:${name}`;
        if (billed.has(key)) continue;
        const viaLocal = [...decls.keys()].some((other) => other !== name && billed.has(`${module}:${other}`) && calls(body, other));
        const viaImport = [...imports].some(([imported, from]) => billed.has(`${from}:${imported}`) && calls(body, imported));
        if (BILLED_PORT.test(body) || viaLocal || viaImport) {
          billed.add(key);
          changed = true;
        }
      }
    }
  }
  return billed;
};

/** 入口の定義（http/endpoints）を1つずつ読み、外の口に触る手続きを呼ぶ入口を `<METHOD> <path>` で返す */
const routesReachingBilledServices = (): string[] => {
  const billed = billedUsecaseFunctions();
  const dir = path.join(LIB, "http", "endpoints");
  const out: string[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    const imports = namedImports(text, "../../usecases/");
    for (const block of text.split(/defineRoute\(\{/).slice(1)) {
      const method = /method:\s*"(\w+)"/.exec(block)?.[1];
      const routePath = /path:\s*"([^"]+)"/.exec(block)?.[1];
      if (!method || !routePath) continue;
      if ([...imports].some(([name, from]) => billed.has(`${from}:${name}`) && calls(block, name))) out.push(`${method} ${routePath}`);
    }
  }
  return out;
};


/**
 * 外のサービスを呼ぶが、表に載せなくてよい入口と、その理由。**ここに足すときは理由を書く**——
 * 黙って足すと、この検査は何も見なくなる。
 * Web プッシュは確保の状態が変わる1回につき1通しか送らない（同じ確保を2度取り消せない・店を2度止められない）ので、
 * 要求の回数が外への呼び出しを増やさない。
 */
const EXEMPT_FROM_RATE_TABLE: ReadonlyMap<string, string> = new Map([
  ["POST /api/store/reservations/:id/cancel", "Web プッシュは確保1件の取り消しにつき1通（同じ確保は2度取り消せない）"],
  ["POST /api/admin/stores/:id/ban", "Web プッシュは店の停止1回につき確保ごとに1通（止めた店は2度止められない）"],
]);

// ---------- 抑止を掛ける入口の表と、数の鍵 ----------

describe("抑止を掛ける入口と鍵", () => {
  it("取得・登録・通報・ログインに規則が在り、ほかの入口（ホーム・オファーの公開）には無い", () => {
    expect(rateRuleFor("POST", "/api/customer/fetch")?.limit).toBe(FETCH_RATE_LIMIT);
    expect(rateRuleFor("POST", "/api/customer/reports")?.by).toBe("customer");
    expect(rateRuleFor("POST", "/api/auth/login")?.counts).toBe("failures");
    expect(rateRuleFor("GET", "/api/customer/home")).toBeNull();
    expect(rateRuleFor("POST", "/api/store/offers")).toBeNull();
    expect(rateRulesFor("GET", "/api/customer/home")).toEqual([]);
  });

  // 2026-09-22 追加。GET でも表が引かれることを併せて確かめる（既存の5つは全部 POST だったため、GET が素通りしないことが未検証だった）。
  it("店の画像の取得にも規則が在り、GET でも表が引かれる", () => {
    const rule = rateRuleFor("GET", "/api/customer/store-image");
    expect(rule).not.toBeNull();
    expect(rule!.limit).toBe(STORE_IMAGE_RATE_LIMIT);
    expect(rule!.by).toBe("customer");
    expect(rule!.counts).toBe("requests");
  });

  // 不具合-04: 合わせて数えていた頃は、同じ回線の11人目で客の自動の登録も店の登録も止まった（要件30.2 の変更・AI判断）。
  it("30.2 客の登録と店の登録は別に数える。客は1時間に60回、店は10回。どちらも接続元で数える", () => {
    const customer = rateRuleFor("POST", "/api/register/customer")!;
    const store = rateRuleFor("POST", "/api/register/store")!;
    expect(customer.name).not.toBe(store.name);
    expect(customer.limit).toBe(CUSTOMER_REGISTER_RATE_LIMIT);
    expect(store.limit).toBe(REGISTER_RATE_LIMIT);
    expect([customer.by, store.by]).toEqual(["ip", "ip"]);
    const source = { ip: "203.0.113.5", customerId: null, input: {} };
    expect(rateKeyFor(store, source)).not.toBe(rateKeyFor(customer, source));
  });

  // 2026-09-26 のレビュー（安全-03・安全-06 の残り）: 客ごとの規則だけだと、客の登録（接続元ごとに1時間60回）で
  // 識別子を作り直せば1つの回線から天井なしに踏めた——地図の候補は毎分およそ3600回、席の押さえ続けも1人でできた。
  it("外のサービスを呼ぶ客の入口と受け取りは、客ごとに加えて接続元ごとにも数える（取得と少しずつ届く取得は合わせて数える）", () => {
    const expected: Array<[string, string, string, number, number]> = [
      ["POST", "/api/customer/fetch", "fetchIp", FETCH_IP_RATE_LIMIT, FETCH_IP_RATE_WINDOW_MS],
      ["POST", "/api/customer/fetch/stream", "fetchIp", FETCH_IP_RATE_LIMIT, FETCH_IP_RATE_WINDOW_MS],
      ["GET", "/api/customer/place-suggest", "placeSuggestIp", PLACE_SUGGEST_IP_RATE_LIMIT, PLACE_SUGGEST_IP_RATE_WINDOW_MS],
      ["GET", "/api/customer/place", "placeIp", PLACE_IP_RATE_LIMIT, PLACE_IP_RATE_WINDOW_MS],
      ["POST", "/api/customer/reservations", "receiveIp", RECEIVE_IP_RATE_LIMIT, RECEIVE_IP_RATE_WINDOW_MS],
    ];
    for (const [method, routePath, name, limit, windowMs] of expected) {
      const rules = rateRulesFor(method, routePath);
      const route = `${method} ${routePath}`;
      expect(rules.some((r) => r.by === "customer"), route).toBe(true);
      expect(rules.find((r) => r.by === "ip"), route).toMatchObject({ name, limit, windowMs, counts: "requests" });
    }
    // 接続元ごとの天井は、1つの窓の中で客ごとの天井より広い（1人の客が、客ごとの天井より先に接続元の天井へ届かない）
    for (const [method, routePath] of expected) {
      const rules = rateRulesFor(method, routePath);
      const perCustomer = rules.find((r) => r.by === "customer")!;
      const perIp = rules.find((r) => r.by === "ip")!;
      expect(perIp.limit, `${method} ${routePath}`).toBeGreaterThan(perCustomer.limit);
    }
  });

  it("表の経路は全部、実在の入口と字面まで一致する（経路の名前が変わったら、黙って抑止が外れないようにここが落ちる）", () => {
    // 以前は表の8経路のうち3つしか見ていなかった（設計-04）。表そのものを歩く
    const known = new Set(ROUTE_DEFINITIONS.map((r) => `${r.method} ${r.path}`));
    const table = rateLimitedRoutes();
    expect(table.length).toBeGreaterThanOrEqual(8);
    for (const route of table) expect(known.has(route), route).toBe(true);
  });

  it("外のサービスを呼ぶ入口を、入口の定義から見つけられる（下の検査の見つけ方の確かめ）", () => {
    const found = routesReachingBilledServices();
    for (const route of [
      "POST /api/customer/fetch",
      "POST /api/customer/fetch/stream",
      "GET /api/customer/place-suggest",
      "GET /api/customer/place",
      "PUT /api/store/profile",
      "POST /api/store/card/setup",
      "POST /api/store/reservations/:id/cancel",
    ]) {
      expect(found, route).toContain(route);
    }
  });

  // 客1人が地図の請求と AI の予算を好きなだけ踏めないように、外のサービスを呼ぶ入口は全部、抑止の表に載せる（安全-03）。
  // 以前は現在地を地名に直す入口（GET /api/customer/place）と店の情報の保存（PUT /api/store/profile）が漏れていた。
  it("安全-03: 外のサービス（地図・AI・外への取得・Stripe・Web プッシュ）を呼ぶ入口は全部、連打の抑止の表に載っている（載せない入口は理由つきの例外だけ）", () => {
    const missing = routesReachingBilledServices().filter((route) => {
      const [method, routePath] = route.split(" ");
      return rateRulesFor(method, routePath).length === 0 && !EXEMPT_FROM_RATE_TABLE.has(route);
    });
    expect(missing).toEqual([]);
  });

  it("例外に挙げた入口は実在し、外のサービスを本当に呼んでいる（古い例外が残って何も見なくなっていない）", () => {
    const found = new Set(routesReachingBilledServices());
    for (const route of EXEMPT_FROM_RATE_TABLE.keys()) expect(found.has(route), route).toBe(true);
  });

  it("人かどうかの確かめ（Turnstile）を呼ぶ入口は全部、連打の抑止の表に載っている", () => {
    const human = ROUTE_DEFINITIONS.filter((r) => r.human).map((r) => `${r.method} ${r.path}`);
    expect(human.length).toBeGreaterThan(0);
    for (const route of human) {
      const [method, routePath] = route.split(" ");
      expect(rateRulesFor(method, routePath).length, route).toBeGreaterThan(0);
    }
  });

  it("鍵は規則ごとに材料が違い、材料が無ければ数えない（null）", () => {
    const fetchRule = rateRuleFor("POST", "/api/customer/fetch")!;
    const registerRule = rateRuleFor("POST", "/api/register/customer")!;
    const [loginRule, loginIpRule] = rateRulesFor("POST", "/api/auth/login");
    const profileRule = rateRuleFor("PUT", "/api/store/profile")!;
    expect(rateKeyFor(fetchRule, { ip: "203.0.113.5", customerId: "cus-1", input: {} })).toBe("fetch:cus-1");
    expect(rateKeyFor(fetchRule, { ip: "203.0.113.5", customerId: null, input: {} })).toBeNull();
    expect(rateKeyFor(registerRule, { ip: null, customerId: "cus-1", input: {} })).toBeNull();
    expect(rateKeyFor(profileRule, { ip: null, customerId: null, accountId: "acc-1", input: {} })).toBe("storeProfile:acc-1");
    expect(rateKeyFor(profileRule, { ip: null, customerId: null, input: {} })).toBeNull();
    // 大文字の別名で数を分けられないよう、メールアドレスは前後の空白を落として小文字へ揃える。接続元と組にする（安全-10）。
    expect(rateKeyFor(loginRule, { ip: "203.0.113.5", customerId: null, input: { email: " Locked@Example.COM " } })).toBe("login:locked@example.com|203.0.113.5");
    // 接続元が無い要求も、メールアドレスごとには数える
    expect(rateKeyFor(loginRule, { ip: null, customerId: null, input: { email: "a@example.com" } })).toBe("login:a@example.com|-");
    expect(rateKeyFor(loginRule, { ip: null, customerId: null, input: { email: 42 } })).toBeNull();
    expect(rateKeyFor(loginIpRule, { ip: "203.0.113.5", customerId: null, input: { email: "x@example.com" } })).toBe("loginIp:203.0.113.5");
  });

  it("不具合-04: 接続元で数える鍵は、IPv6 を /64 に丸める（末尾を変えても同じ数え）", () => {
    const registerRule = rateRuleFor("POST", "/api/register/customer")!;
    const a = rateKeyFor(registerRule, { ip: "2001:db8:1:2::10", customerId: null, input: {} });
    const b = rateKeyFor(registerRule, { ip: "2001:db8:1:2:aaaa:bbbb:cccc:dddd", customerId: null, input: {} });
    expect(a).toBe("registerCustomer:2001:db8:1:2::/64");
    expect(b).toBe(a);
  });
});

// ---------- defineRoute に掛かっていること ----------

const fetchRoute = (onHandled: () => void) =>
  defineRoute({
    method: "POST",
    path: "/api/customer/fetch",
    auth: "customer",
    handler: async () => {
      // 実物の取得はここで AI と地図を呼ぶ。ここが動かなければ、どちらも呼ばれない（基準 30.5）。
      onHandled();
      return { status: 200, body: { ok: true } };
    },
  });

const cookieOf = (token: string) => ({ cookie: `${CUSTOMER_COOKIE_NAME}=${token}` });

describe("30.1・30.5 同じ客の取得は1分に5回まで", () => {
  it("6回目は 429 rate_limited で手続きが動かず、1分たつとまた通る。別の客は数えない", async () => {
    let handled = 0;
    const route = fetchRoute(() => {
      handled++;
    });
    const { deps, clock } = await makeDeps({ [hashOf("tok-a")]: "cus-a", [hashOf("tok-b")]: "cus-b" });
    const call = (token: string) => route.handle(post("/api/customer/fetch", { party: 2 }, cookieOf(token)), deps);

    for (let i = 0; i < FETCH_RATE_LIMIT; i++) expect((await call("tok-a")).status, String(i)).toBe(200);
    expect(handled).toBe(FETCH_RATE_LIMIT);

    const sixth = await call("tok-a");
    expect(sixth.status).toBe(429);
    expect((await jsonOf(sixth)).error?.kind).toBe("rate_limited");
    // 手続きが1度も増えていない＝断った取得では AI も地図も呼ばれない（基準 30.5）。
    expect(handled).toBe(FETCH_RATE_LIMIT);

    expect((await call("tok-b")).status).toBe(200);

    clock.set(at(1));
    expect((await call("tok-a")).status).toBe(200);
    expect(handled).toBe(FETCH_RATE_LIMIT + 2);
  });

  it("安全-02: 同じ客が20本同時に送っても、手続きが動くのは上限の5本だけ", async () => {
    let handled = 0;
    const route = fetchRoute(() => {
      handled++;
    });
    const { deps } = await makeDeps({ [hashOf("tok-race")]: "cus-race" });
    const results = await Promise.all(Array.from({ length: 20 }, () => route.handle(post("/api/customer/fetch", { party: 2 }, cookieOf("tok-race")), deps)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(FETCH_RATE_LIMIT);
    expect(results.filter((r) => r.status === 429)).toHaveLength(20 - FETCH_RATE_LIMIT);
    expect(handled).toBe(FETCH_RATE_LIMIT);
  });
});

describe("30.2 同じ接続元の登録（客と店は別に数える・不具合-04）", () => {
  const registerRoute = (path: string) =>
    defineRoute({ method: "POST", path, auth: "public", human: path.endsWith("/store") ? "register-store" : "register-customer", handler: async () => ({ status: 201, body: { ok: true } }) });
  const body = { humanToken: "tok-ok" };

  it("店の登録は11回目を断る。客の登録はその接続元でも通る。別の接続元は数えない。1時間たつと通る", async () => {
    const customerRoute = registerRoute("/api/register/customer");
    const storeRoute = registerRoute("/api/register/store");
    const { deps, clock } = await makeDeps();
    clock.set(at(10));
    const call = (route: typeof customerRoute, ip: string) => route.handle(post(route.path, body, { "cf-connecting-ip": ip }), deps);

    for (let i = 0; i < REGISTER_RATE_LIMIT; i++) expect((await call(storeRoute, "203.0.113.5")).status, `店${i}`).toBe(201);
    const eleventh = await call(storeRoute, "203.0.113.5");
    expect(eleventh.status).toBe(429);
    expect((await jsonOf(eleventh)).error?.kind).toBe("rate_limited");
    // 客の登録は店の登録の数を分け合わない（会場の回線で店の登録が混んでも、客は入れる）
    expect((await call(customerRoute, "203.0.113.5")).status).toBe(201);
    expect((await call(storeRoute, "203.0.113.6")).status).toBe(201);

    clock.set(at(71));
    expect((await call(storeRoute, "203.0.113.5")).status).toBe(201);
  });

  it("客の登録は同じ接続元から1時間に60回まで。61回目は断る", async () => {
    const customerRoute = registerRoute("/api/register/customer");
    const { deps } = await makeDeps();
    const call = () => customerRoute.handle(post(customerRoute.path, body, { "cf-connecting-ip": "198.51.100.9" }), deps);
    for (let i = 0; i < CUSTOMER_REGISTER_RATE_LIMIT; i++) expect((await call()).status, String(i)).toBe(201);
    expect((await call()).status).toBe(429);
  });

  it("不具合-04: 人かどうかの確かめに落ちた要求は数えない（確かめを解かずに送るだけでは、同じ回線の人を止められない）", async () => {
    const storeRoute = registerRoute("/api/register/store");
    const { deps, human, counterCount } = await makeDeps();
    human.pass = false;
    for (let i = 0; i < REGISTER_RATE_LIMIT + 5; i++) {
      const r = await storeRoute.handle(post(storeRoute.path, { humanToken: "bot" }, { "cf-connecting-ip": "203.0.113.50" }), deps);
      expect(r.status, String(i)).toBe(400);
    }
    expect(await counterCount()).toBe(0);
    human.pass = true;
    expect((await storeRoute.handle(post(storeRoute.path, body, { "cf-connecting-ip": "203.0.113.50" }), deps)).status).toBe(201);
  });

  it("不具合-04: 同じ /64 の IPv6 は、末尾を変えても同じ数え（店の登録の11回目を断る）", async () => {
    const storeRoute = registerRoute("/api/register/store");
    const { deps } = await makeDeps();
    for (let i = 0; i < REGISTER_RATE_LIMIT; i++) {
      expect((await storeRoute.handle(post(storeRoute.path, body, { "cf-connecting-ip": `2001:db8:5:6::${i + 1}` }), deps)).status, String(i)).toBe(201);
    }
    expect((await storeRoute.handle(post(storeRoute.path, body, { "cf-connecting-ip": "2001:db8:5:6:ffff::1" }), deps)).status).toBe(429);
  });

  it("接続元の見出しが無い要求は数えない（無い値を1つの鍵へまとめない）", async () => {
    const storeRoute = registerRoute("/api/register/store");
    const { deps, counterCount } = await makeDeps();
    for (let i = 0; i < REGISTER_RATE_LIMIT + 2; i++) {
      expect((await storeRoute.handle(post("/api/register/store", body), deps)).status, String(i)).toBe(201);
    }
    expect(await counterCount()).toBe(0);
  });
});

describe("30.4 同じアカウントへの、同じ接続元からのログインの失敗が10回続くと15分断る", () => {
  const RIGHT = "right-password-1";
  const loginRoute = (onHandled: () => void) =>
    defineRoute({
      method: "POST",
      path: "/api/auth/login",
      auth: "public",
      human: "login",
      handler: async ({ input }) => {
        onHandled();
        const { password } = input as { password: string };
        // 実物と同じ形だけ写す: 合わなければ 401 login_failed（どちらが違うかは言わない）。
        return password === RIGHT ? { status: 200, body: { ok: true } } : { status: 401, body: { ok: false, error: { kind: "login_failed" } } };
      },
    });

  const IP = "203.0.113.40";
  const login = (route: ReturnType<typeof loginRoute>, deps: Deps, email: string, password: string, ip = IP) =>
    route.handle(post("/api/auth/login", { email, password, humanToken: "tok-ok" }, { "cf-connecting-ip": ip }), deps);

  it("正しいパスワードでも断り、15分たつと通る。別のアカウントは数えない。断った要求では手続きが動かない", async () => {
    let handled = 0;
    const route = loginRoute(() => {
      handled++;
    });
    const { deps, clock } = await makeDeps();
    clock.set(at(200));

    for (let i = 0; i < LOGIN_FAILURE_LIMIT; i++) {
      expect((await login(route, deps, "locked@example.com", `wrong-${i}`)).status, String(i)).toBe(401);
    }
    const handledAfterFailures = handled;

    const locked = await login(route, deps, "locked@example.com", RIGHT);
    expect(locked.status).toBe(429);
    expect((await jsonOf(locked)).error?.kind).toBe("rate_limited");
    // 断った要求では、手続き（パスワードの計算）が動かない。
    // ⚠️ 人かどうかの確かめは呼ぶ——数えるのを確かめの後へ移した（不具合-04: 空振りで回数を減らさない）。
    expect(handled).toBe(handledAfterFailures);

    expect((await login(route, deps, "free@example.com", RIGHT)).status).toBe(200);

    clock.set(at(214));
    expect((await login(route, deps, "locked@example.com", RIGHT)).status).toBe(429);
    clock.set(at(216));
    expect((await login(route, deps, "locked@example.com", RIGHT)).status).toBe(200);
  });

  // 案1（勧める案が無いので最初の案・AI判断）: 鍵を「メールアドレス×接続元」にする。他人が別の接続元から間違え続けても、
  // 本人は締め出されない（以前の検査は「アカウント単位の締め出し」を正しい振る舞いとして固めていた・設計-04）。
  it("安全-10: 他人が別の接続元から10回間違えても、本人の接続元からの正しいパスワードは締め出されない", async () => {
    const route = loginRoute(() => {});
    const { deps, clock } = await makeDeps();
    clock.set(at(300));
    for (let i = 0; i < LOGIN_FAILURE_LIMIT; i++) expect((await login(route, deps, "owner@example.com", `wrong-${i}`, "198.51.100.66")).status, String(i)).toBe(401);
    expect((await login(route, deps, "owner@example.com", `wrong-x`, "198.51.100.66")).status).toBe(429);
    expect((await login(route, deps, "owner@example.com", RIGHT, "203.0.113.10")).status).toBe(200);
  });

  it("安全-10: 1つの接続元から多数のアカウントへ1回ずつ試すと、アカウントをまたいで30回で断る（パスワードスプレー）", async () => {
    const route = loginRoute(() => {});
    const { deps } = await makeDeps();
    for (let i = 0; i < LOGIN_IP_FAILURE_LIMIT; i++) expect((await login(route, deps, `victim-${i}@example.com`, "guess-1")).status, String(i)).toBe(401);
    expect((await login(route, deps, "victim-next@example.com", "guess-1")).status).toBe(429);
    // 別の接続元は数えない
    expect((await login(route, deps, "victim-next@example.com", "guess-1", "203.0.113.99")).status).toBe(401);
  });

  it("安全-10: 接続元ごとの数えは、通ったログインでその1回ぶんだけ戻る（成功を挟んでも失敗の数は消えない）", async () => {
    const route = loginRoute(() => {});
    const { deps, counterOf } = await makeDeps();
    for (let i = 0; i < 5; i++) await login(route, deps, `victim-${i}@example.com`, "guess-1");
    expect((await login(route, deps, "mine@example.com", RIGHT)).status).toBe(200);
    expect((await counterOf("loginIp:203.0.113.40"))?.count).toBe(5);
  });

  it("安全-02: 同じアカウントへ同じ接続元から30本同時に間違えても、手続きが動くのは上限の10本だけ", async () => {
    let handled = 0;
    const route = loginRoute(() => {
      handled++;
    });
    const { deps } = await makeDeps();
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => login(route, deps, "race@example.com", `wrong-${i}`)));
    expect(results.filter((r) => r.status === 401)).toHaveLength(LOGIN_FAILURE_LIMIT);
    expect(results.filter((r) => r.status === 429)).toHaveLength(30 - LOGIN_FAILURE_LIMIT);
    expect(handled).toBe(LOGIN_FAILURE_LIMIT);
  });

  // レビューの指摘: 接続元ごとの失敗の上限は正しいパスワードも断るので、会場の Wi-Fi や携帯の CGNAT で同じ回線の
  // 他人が30回間違えると、その回線の店と運営が全員15分入れなくなった。「上限を超えても照合が通れば通す」にすると、
  // 上限を超えたあとも 200 と 429 で当たり外れが分かり、スプレーの上限そのものが無くなる。
  // そこで、前にこの端末（ブラウザ）でそのアカウントに通った印（端末の Cookie）を持つ要求だけ、接続元の上限を数えない。
  describe("安全-10 のレビュー: 端末の印", () => {
    const DEVICE = "d".repeat(22);
    const deviceCookie = { cookie: `${LOGIN_DEVICE_COOKIE_NAME}=${DEVICE}` };
    const loginWith = (route: ReturnType<typeof loginRoute>, deps: Deps, email: string, password: string, headers: Record<string, string> = {}) =>
      route.handle(post("/api/auth/login", { email, password, humanToken: "tok-ok" }, { "cf-connecting-ip": IP, ...headers }), deps);
    const spray = async (route: ReturnType<typeof loginRoute>, deps: Deps) => {
      for (let i = 0; i < LOGIN_IP_FAILURE_LIMIT; i++) expect((await login(route, deps, `victim-${i}@example.com`, "guess-1")).status, String(i)).toBe(401);
      expect((await login(route, deps, "victim-next@example.com", "guess-1")).status).toBe(429);
    };

    it("前にこの端末でそのアカウントに通っていれば、同じ回線の他人が上限まで間違えたあとでも入れる", async () => {
      const route = loginRoute(() => {});
      const { deps, db, clock } = await makeDeps();
      clock.set(at(500));
      await rememberLoginDevice(db, { email: "Owner@Example.com", tokenHash: hashOf(DEVICE), nowIso: at(400) });
      await spray(route, deps);
      expect((await loginWith(route, deps, "owner@example.com", RIGHT, deviceCookie)).status).toBe(200);
    });

    it("印が無い・別のアカウントの印・形の違う印・30日より古い印では、接続元の上限で断る（スプレーの上限は残る）", async () => {
      const route = loginRoute(() => {});
      const { deps, db, clock } = await makeDeps();
      clock.set(at(500));
      await rememberLoginDevice(db, { email: "owner@example.com", tokenHash: hashOf(DEVICE), nowIso: at(400) });
      await rememberLoginDevice(db, { email: "stale@example.com", tokenHash: hashOf(DEVICE), nowIso: new Date(Date.parse(at(500)) - LOGIN_DEVICE_TRUST_MS - MIN).toISOString() });
      await spray(route, deps);
      expect((await loginWith(route, deps, "owner@example.com", RIGHT)).status).toBe(429);
      expect((await loginWith(route, deps, "someone-else@example.com", RIGHT, deviceCookie)).status).toBe(429);
      expect((await loginWith(route, deps, "stale@example.com", RIGHT, deviceCookie)).status).toBe(429);
      await rememberLoginDevice(db, { email: "odd@example.com", tokenHash: hashOf("x"), nowIso: at(400) });
      expect((await loginWith(route, deps, "odd@example.com", RIGHT, { cookie: `${LOGIN_DEVICE_COOKIE_NAME}=x` })).status).toBe(429);
    });

    it("印があっても、そのアカウントへの同じ接続元からの失敗10回（基準 30.4）は数える", async () => {
      const route = loginRoute(() => {});
      const { deps, db, clock } = await makeDeps();
      clock.set(at(500));
      await rememberLoginDevice(db, { email: "owner@example.com", tokenHash: hashOf(DEVICE), nowIso: at(400) });
      for (let i = 0; i < LOGIN_FAILURE_LIMIT; i++) expect((await loginWith(route, deps, "owner@example.com", `wrong-${i}`, deviceCookie)).status, String(i)).toBe(401);
      expect((await loginWith(route, deps, "owner@example.com", RIGHT, deviceCookie)).status).toBe(429);
    });
  });

  it("通ったら数が消える＝失敗の続きが切れる（9回失敗して1回通ると、数え直しになる）", async () => {
    const route = loginRoute(() => {});
    const { deps, counterOf } = await makeDeps();
    for (let i = 0; i < LOGIN_FAILURE_LIMIT - 1; i++) await login(route, deps, "locked@example.com", `wrong-${i}`);
    expect((await counterOf(`login:locked@example.com|${IP}`))?.count).toBe(LOGIN_FAILURE_LIMIT - 1);

    expect((await login(route, deps, "locked@example.com", RIGHT)).status).toBe(200);
    expect(await counterOf(`login:locked@example.com|${IP}`)).toBeNull();

    for (let i = 0; i < LOGIN_FAILURE_LIMIT - 1; i++) {
      expect((await login(route, deps, "locked@example.com", `again-${i}`)).status, String(i)).toBe(401);
    }
  });
});
