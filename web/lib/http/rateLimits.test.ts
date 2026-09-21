// 連打の抑止（要件30【最終日】）の数え方と、defineRoute に掛かっていることの検査。
//
// ⚠️ 受け入れ検査 r30-rate-limit.test.ts は、取得（POST /api/customer/fetch）・公開・通報の入口を
// 使うので、それらのタスクが入るまで走らない（この作業ツリーでは 404 で場面の準備から落ちる）。
// そこで、同じ4つの基準を「入口の手前の仕組み」の側から固定しておく:
//   30.1 同じ客の取得は1分に5回／30.2 同じ接続元の登録は1時間に10回（客と店を合わせて）／
//   30.3 同じ客の通報は1時間に5回／30.4 ログインの失敗10回で15分／30.5 断った要求で手続きが動かない
// 偽の D1 は rate_counters と customers の2つの問い合わせだけを受ける（このファイルの中だけの道具）。

import { describe, expect, it } from "vitest";
import type { Deps } from "../ports";
import type { RateCounterRow } from "../repo/rateCounters";
import { FETCH_RATE_LIMIT, LOGIN_FAILURE_LIMIT, LOGIN_LOCK_WINDOW_MS, REGISTER_RATE_LIMIT } from "../schemas/limits";
import { CUSTOMER_COOKIE_NAME } from "./cookies";
import { defineRoute } from "./defineRoute";
import { decideRate, rateKeyFor, rateRuleFor, type RateRule } from "./rateLimits";
import { ROUTE_DEFINITIONS } from "./routes";

const ORIGIN = "https://app.test";
const T0 = "2026-09-22T06:00:00.000Z";
const MIN = 60_000;
const at = (minutes: number) => new Date(Date.parse(T0) + minutes * MIN).toISOString();

// ---------- 偽の道具 ----------

/** rate_counters と customers だけを覚える偽の D1（文の中身で見分ける）。 */
const fakeDb = (customers: Record<string, string> = {}) => {
  const counters = new Map<string, RateCounterRow>();
  const statement = (sql: string, args: unknown[]) => {
    const key = String(args[0] ?? "");
    const run = async () => {
      if (/^\s*DELETE/i.test(sql)) counters.delete(key);
      if (/^\s*INSERT/i.test(sql)) counters.set(key, { windowStartIso: String(args[1]), count: Number(args[2]) });
      return { success: true };
    };
    return {
      run,
      first: async () => {
        if (/FROM customers/i.test(sql)) return customers[key] ? { id: customers[key] } : null;
        const row = counters.get(key);
        return row ? { window_start: row.windowStartIso, count: row.count } : null;
      },
    };
  };
  return {
    counters,
    prepare: (sql: string) => ({ bind: (...args: unknown[]) => statement(sql, args) }),
    batch: async (stmts: Array<{ run: () => Promise<unknown> }>) => Promise.all(stmts.map((s) => s.run())),
  };
};

const fakeClock = (startIso = T0) => {
  let nowMs = Date.parse(startIso);
  return {
    now: () => new Date(nowMs),
    // 人かどうかの確かめの打ち切りは、この検査では起こさない（偽の確かめがすぐ返る）。
    after: () => new Promise<void>(() => {}),
    set: (iso: string) => {
      nowMs = Date.parse(iso);
    },
  };
};

/** 客の Cookie の値 → 客の番号。見分けは値を SHA-256 にして引くので、偽の Hasher も同じ形で写す。 */
const hashOf = (value: string) => `sha256(${value})`;

const makeDeps = (customers: Record<string, string> = {}) => {
  const db = fakeDb(customers);
  const clock = fakeClock();
  /** 人かどうかの確かめが呼ばれた回数（断った要求で外へ聞きに行っていないことを見る）。 */
  const human = { calls: 0 };
  const deps = {
    db,
    clock,
    hasher: { sha256Hex: async (value: string) => hashOf(value), derive: async () => "" },
    human: {
      verify: async () => {
        human.calls++;
        return { ok: true as const, human: true };
      },
    },
  } as unknown as Deps;
  return { deps, db, clock, human };
};

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, ...headers }, body: JSON.stringify(body) });

const jsonOf = async (res: Response) => (await res.json()) as { ok: boolean; error?: { kind?: string } };

// ---------- 数え方（純粋な関数） ----------

describe("decideRate: 固定の窓で数え、上限に届いた回で窓を貼り直す", () => {
  const rule: RateRule = { name: "t", limit: 3, windowMs: 60_000, by: "ip", counts: "requests" };

  it("行が無ければ1回目として通し、窓は今から始まる", () => {
    expect(decideRate(rule, null, at(0))).toEqual({ refused: false, next: { windowStartIso: at(0), count: 1 } });
  });

  it("窓の中では数を足し、窓の始まりは動かさない（上限に届く回までは）", () => {
    expect(decideRate(rule, { windowStartIso: at(0), count: 1 }, at(0.5))).toEqual({ refused: false, next: { windowStartIso: at(0), count: 2 } });
  });

  it("上限に届いた回は、その時刻へ窓を貼り直す（そこから窓の長さだけ断るため）", () => {
    expect(decideRate(rule, { windowStartIso: at(0), count: 2 }, at(0.5))).toEqual({ refused: false, next: { windowStartIso: at(0.5), count: 3 } });
  });

  it("上限に届いていれば断る（断った回は数えないので、窓は延びない）", () => {
    expect(decideRate(rule, { windowStartIso: at(0), count: 3 }, at(0.9))).toEqual({ refused: true });
  });

  it("窓の長さがちょうど過ぎたら、新しい窓の1回目として通す", () => {
    expect(decideRate(rule, { windowStartIso: at(0), count: 3 }, at(1))).toEqual({ refused: false, next: { windowStartIso: at(1), count: 1 } });
  });

  it("窓の始まりが日付として読めない行は、新しい窓として数え直す（フェイルオープン）", () => {
    expect(decideRate(rule, { windowStartIso: "こわれた値", count: 99 }, at(0))).toEqual({ refused: false, next: { windowStartIso: at(0), count: 1 } });
  });

  it("30.4 失敗が窓の中に散っていても、10回目から15分ちょうど断る", () => {
    const login: RateRule = { name: "login", limit: LOGIN_FAILURE_LIMIT, windowMs: LOGIN_LOCK_WINDOW_MS, by: "loginEmail", counts: "failures" };
    // 1回目が0分・10回目が10分。10回目で窓を貼り直すので、断りが明けるのは25分（10分＋15分）。
    const tenth = decideRate(login, { windowStartIso: at(0), count: 9 }, at(10));
    expect(tenth).toEqual({ refused: false, next: { windowStartIso: at(10), count: 10 } });
    expect(decideRate(login, { windowStartIso: at(10), count: 10 }, at(24.9)).refused).toBe(true);
    expect(decideRate(login, { windowStartIso: at(10), count: 10 }, at(25)).refused).toBe(false);
  });
});

// ---------- 抑止を掛ける入口の表と、数の鍵 ----------

describe("抑止を掛ける入口と鍵", () => {
  it("取得・登録（客と店）・通報・ログインの5つの経路に規則が在り、ほかの入口には無い", () => {
    expect(rateRuleFor("POST", "/api/customer/fetch")?.limit).toBe(FETCH_RATE_LIMIT);
    expect(rateRuleFor("POST", "/api/customer/reports")?.by).toBe("customer");
    expect(rateRuleFor("POST", "/api/auth/login")?.counts).toBe("failures");
    expect(rateRuleFor("GET", "/api/customer/home")).toBeNull();
    expect(rateRuleFor("POST", "/api/store/offers")).toBeNull();
  });

  it("30.2 客の登録と店の登録は同じ名前で数える（合わせて1時間に10回）", () => {
    const customer = rateRuleFor("POST", "/api/register/customer")!;
    const store = rateRuleFor("POST", "/api/register/store")!;
    expect(customer.name).toBe(store.name);
    expect(customer.limit).toBe(REGISTER_RATE_LIMIT);
    expect(customer.by).toBe("ip");
    const source = { ip: "203.0.113.5", customerId: null, input: {} };
    expect(rateKeyFor(store, source)).toBe(rateKeyFor(customer, source));
  });

  it("表の経路は実在の入口と字面まで一致する（経路の名前が変わったら、黙って抑止が外れないようにここが落ちる）", () => {
    const known = new Set(ROUTE_DEFINITIONS.map((r) => `${r.method} ${r.path}`));
    for (const route of ["POST /api/register/customer", "POST /api/register/store", "POST /api/auth/login"]) {
      expect(known.has(route), route).toBe(true);
    }
    // 取得（POST /api/customer/fetch）と通報（POST /api/customer/reports）は別のタスクが作る入口なので、
    // まだ一覧に無い。経路が出来た時点で表から自動で抑止が掛かる（向こうの実装に足すものは無い）。
  });

  it("鍵は規則ごとに材料が違い、材料が無ければ数えない（null）", () => {
    const fetchRule = rateRuleFor("POST", "/api/customer/fetch")!;
    const registerRule = rateRuleFor("POST", "/api/register/customer")!;
    const loginRule = rateRuleFor("POST", "/api/auth/login")!;
    expect(rateKeyFor(fetchRule, { ip: "203.0.113.5", customerId: "cus-1", input: {} })).toBe("fetch:cus-1");
    expect(rateKeyFor(fetchRule, { ip: "203.0.113.5", customerId: null, input: {} })).toBeNull();
    expect(rateKeyFor(registerRule, { ip: null, customerId: "cus-1", input: {} })).toBeNull();
    // 大文字の別名で数を分けられないよう、メールアドレスは前後の空白を落として小文字へ揃える。
    expect(rateKeyFor(loginRule, { ip: null, customerId: null, input: { email: " Locked@Example.COM " } })).toBe("login:locked@example.com");
    expect(rateKeyFor(loginRule, { ip: null, customerId: null, input: { email: 42 } })).toBeNull();
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

describe("30.1・30.5 同じ客の取得は1分に5回まで", () => {
  const cookieOf = (token: string) => ({ cookie: `${CUSTOMER_COOKIE_NAME}=${token}` });

  it("6回目は 429 rate_limited で手続きが動かず、1分たつとまた通る。別の客は数えない", async () => {
    let handled = 0;
    const route = fetchRoute(() => {
      handled++;
    });
    const { deps, clock } = makeDeps({ [hashOf("tok-a")]: "cus-a", [hashOf("tok-b")]: "cus-b" });
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
});

describe("30.2 同じ接続元の客の登録と店の登録は合わせて1時間に10回まで", () => {
  const registerRoute = (path: string) =>
    defineRoute({ method: "POST", path, auth: "public", handler: async () => ({ status: 201, body: { ok: true } }) });

  it("11回目は断る。別の接続元は数えない。1時間たつと通る", async () => {
    const customerRoute = registerRoute("/api/register/customer");
    const storeRoute = registerRoute("/api/register/store");
    const { deps, clock } = makeDeps();
    clock.set(at(10));
    const call = (route: typeof customerRoute, ip: string) => route.handle(post(route.path, {}, { "cf-connecting-ip": ip }), deps);

    for (let i = 0; i < 6; i++) expect((await call(customerRoute, "203.0.113.5")).status, `客${i}`).toBe(201);
    for (let i = 0; i < 4; i++) expect((await call(storeRoute, "203.0.113.5")).status, `店${i}`).toBe(201);

    const eleventh = await call(customerRoute, "203.0.113.5");
    expect(eleventh.status).toBe(429);
    expect((await jsonOf(eleventh)).error?.kind).toBe("rate_limited");
    expect((await call(customerRoute, "203.0.113.6")).status).toBe(201);

    clock.set(at(71));
    expect((await call(customerRoute, "203.0.113.5")).status).toBe(201);
  });

  it("接続元の見出しが無い要求は数えない（無い値を1つの鍵へまとめない）", async () => {
    const customerRoute = registerRoute("/api/register/customer");
    const { deps, db } = makeDeps();
    for (let i = 0; i < REGISTER_RATE_LIMIT + 2; i++) {
      expect((await customerRoute.handle(post("/api/register/customer", {}), deps)).status, String(i)).toBe(201);
    }
    expect(db.counters.size).toBe(0);
  });
});

describe("30.4 同じアカウントへのログインの失敗が10回続くと15分断る", () => {
  const RIGHT = "right-password-1";
  const loginRoute = (onHandled: () => void) =>
    defineRoute({
      method: "POST",
      path: "/api/auth/login",
      auth: "public",
      human: true,
      handler: async ({ input }) => {
        onHandled();
        const { password } = input as { password: string };
        // 実物と同じ形だけ写す: 合わなければ 401 login_failed（どちらが違うかは言わない）。
        return password === RIGHT ? { status: 200, body: { ok: true } } : { status: 401, body: { ok: false, error: { kind: "login_failed" } } };
      },
    });

  const login = (route: ReturnType<typeof loginRoute>, deps: Deps, email: string, password: string) =>
    route.handle(post("/api/auth/login", { email, password, humanToken: "tok-ok" }), deps);

  it("正しいパスワードでも断り、15分たつと通る。別のアカウントは数えない。人かどうかの確かめも呼ばない", async () => {
    let handled = 0;
    const route = loginRoute(() => {
      handled++;
    });
    const { deps, clock, human } = makeDeps();
    clock.set(at(200));

    for (let i = 0; i < LOGIN_FAILURE_LIMIT; i++) {
      expect((await login(route, deps, "locked@example.com", `wrong-${i}`)).status, String(i)).toBe(401);
    }
    const handledAfterFailures = handled;
    const humanCallsAfterFailures = human.calls;

    const locked = await login(route, deps, "locked@example.com", RIGHT);
    expect(locked.status).toBe(429);
    expect((await jsonOf(locked)).error?.kind).toBe("rate_limited");
    // 断った要求では、手続きも外の確かめも動かない（パスワードの計算も Turnstile も走らない）。
    expect(handled).toBe(handledAfterFailures);
    expect(human.calls).toBe(humanCallsAfterFailures);

    expect((await login(route, deps, "free@example.com", RIGHT)).status).toBe(200);

    clock.set(at(214));
    expect((await login(route, deps, "locked@example.com", RIGHT)).status).toBe(429);
    clock.set(at(216));
    expect((await login(route, deps, "locked@example.com", RIGHT)).status).toBe(200);
  });

  it("通ったら数が消える＝失敗の続きが切れる（9回失敗して1回通ると、数え直しになる）", async () => {
    const route = loginRoute(() => {});
    const { deps, db } = makeDeps();
    for (let i = 0; i < LOGIN_FAILURE_LIMIT - 1; i++) await login(route, deps, "locked@example.com", `wrong-${i}`);
    expect(db.counters.get("login:locked@example.com")?.count).toBe(LOGIN_FAILURE_LIMIT - 1);

    expect((await login(route, deps, "locked@example.com", RIGHT)).status).toBe(200);
    expect(db.counters.has("login:locked@example.com")).toBe(false);

    for (let i = 0; i < LOGIN_FAILURE_LIMIT - 1; i++) {
      expect((await login(route, deps, "locked@example.com", `again-${i}`)).status, String(i)).toBe(401);
    }
  });
});
