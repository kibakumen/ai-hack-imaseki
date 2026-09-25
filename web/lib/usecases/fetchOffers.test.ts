// 取得の手続き（usecases/fetchOffers）のうち、受け入れ検査が入口越しには見にくい2つを直に見る。
//   ①AI の打ち切り（基準 7.6 の6秒）は、起点が決まってから数える（2026-09-25 監査の指摘 不具合-20）
//   ②取得1回の記録（fetch_logs・ai_calls・fetch_items）を1つのまとまりで書く（同 不具合-08 の取得の分）
// 場面（D1・承認済みの店・公開中のオファー・客）は受け入れ検査の道具で作り、差し替え口だけをこの検査の偽物にする。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvedStore, makeCtx, one, publishOffer, registerCustomer, selectionText, SHIBUYA, type Ctx } from "../../../tests/acceptance/v2/_fakes";
import type { AiSelectResult, AiSelector, Deps, Geocoder } from "../ports";
import type { D1PreparedStatement } from "../repo/d1";
import { TEXTS } from "../domain/texts";
import { fetchOffers } from "./fetchOffers";

let ctx: Ctx;
let customerId: string;
let storeId: string;

beforeAll(async () => {
  ctx = await makeCtx();
  const store = await approvedStore(ctx, { name: "打ち切りの店", genres: ["和食"], menus: ["刺身盛り"] });
  await publishOffer(store.api, { capacity: 3, partyMax: 4 });
  storeId = store.id;
  const customer = await registerCustomer(ctx, { nickname: "うちきり", phone: "08077770001" });
  expect(customer.cookie).toBeTruthy();
  customerId = (await one<{ id: string }>(ctx.db, "SELECT id FROM customers WHERE nickname = ?1", "うちきり"))!.id;
});
afterAll(async () => {
  await ctx.dispose();
});

/** 条件が立つまで実時間で待つ（手続きが D1 を読み終えて AI を呼ぶまでの隙を待つ） */
const until = async (ready: () => boolean, withinMs = 2_000): Promise<void> => {
  const started = Date.now();
  while (!ready()) {
    if (Date.now() - started > withinMs) throw new Error("待っていた出来事が起きませんでした");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

describe("AI の打ち切りは起点が決まってから数える（不具合-20）", () => {
  it("場所の文字を位置に直すのに2.5秒かかっても、AI は起点が決まってから6秒まで待ってもらえる", async () => {
    // 地図は偽の時計で2.5秒かかる
    let geocodeStarted = false;
    const geocoder: Geocoder = {
      geocode: async () => {
        geocodeStarted = true;
        await ctx.clock.after(2_500);
        return { ok: true, lat: SHIBUYA.lat, lng: SHIBUYA.lng };
      },
    };
    // AI は検査が返すまで返らない（打ち切りの合図が来たら失敗として返る）
    const asked: unknown[] = [];
    let answer: ((result: AiSelectResult) => void) | null = null;
    const ai: AiSelector = {
      select: (input, opts) =>
        new Promise<AiSelectResult>((resolve) => {
          asked.push(input);
          answer = resolve;
          opts.signal?.addEventListener("abort", () => resolve({ ok: false, error: "aborted" }));
        }),
    };
    const deps: Deps = { ...ctx.deps, geocoder, ai };

    const pending = fetchOffers(deps, customerId, { party: 2, place: "渋谷駅" });
    // 地図を呼ぶ前に、その日の地図の回数を D1 で数える（usecases/mapsBudget・2026-09-26）。地図の2.5秒の時計が
    // 張られてから進める
    await until(() => geocodeStarted);
    await ctx.clock.advance(2_500);
    await until(() => asked.length === 1);
    // 手続きの始まりから6.5秒・AI を呼んでから4秒。以前は始まりから6秒で打ち切られ、点数順に倒れた
    await ctx.clock.advance(4_000);
    answer!({ ok: true, text: selectionText([{ storeId, reason: "和食好きに歩いて行ける距離です" }]), costUsd: 0.001 });
    const result = await pending;

    expect(result.ok).toBe(true);
    const item = result.ok ? result.items.find((i) => i.storeId === storeId) : undefined;
    expect(item?.reason).toBe("和食好きに歩いて行ける距離です");
    expect(item?.reason).not.toBe(TEXTS.fallbackReason);
  });
});

/**
 * 書き込みを数える D1（文の SQL を覚える）。まとまり（batch）に渡すときは実物の文へ戻す——miniflare の D1 は
 * 自分の作った文しか受けない。
 */
const countingDb = (db: Deps["db"]) => {
  const runs: string[] = [];
  const batches: string[][] = [];
  const real = new WeakMap<object, { statement: D1PreparedStatement; sql: string }>();
  const wrap = (statement: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const wrapped: D1PreparedStatement = {
      bind: (...values: unknown[]) => wrap(statement.bind(...values), sql),
      first: () => statement.first(),
      all: () => statement.all(),
      run: () => {
        runs.push(sql);
        return statement.run();
      },
      raw: () => statement.raw(),
    } as D1PreparedStatement;
    real.set(wrapped, { statement, sql });
    return wrapped;
  };
  const counted: Deps["db"] = {
    prepare: (sql: string) => wrap(db.prepare(sql), sql),
    batch: (statements: D1PreparedStatement[]) => {
      batches.push(statements.map((s) => real.get(s)?.sql ?? "?"));
      return db.batch(statements.map((s) => real.get(s)?.statement ?? s));
    },
    exec: (sql: string) => db.exec(sql),
  };
  return { db: counted, runs, batches };
};

const LOG_TABLES = ["fetch_logs", "ai_calls", "fetch_items"];
const writesTo = (sql: string, table: string): boolean => new RegExp(`INSERT\\s+INTO\\s+${table}\\b`, "i").test(sql);

describe("取得1回の記録は1つのまとまりで書く（不具合-08 の取得の分）", () => {
  it("取得の記録・AI の呼び出しの記録・返した店の記録を、1回の往復（db.batch）で書く", async () => {
    const counting = countingDb(ctx.deps.db);
    const deps: Deps = { ...ctx.deps, db: counting.db };
    const result = await fetchOffers(deps, customerId, { party: 2, lat: SHIBUYA.lat, lng: SHIBUYA.lng });
    expect(result.ok).toBe(true);

    // 3つの表へ、1文ずつの run では書いていない
    for (const table of LOG_TABLES) expect(counting.runs.filter((sql) => writesTo(sql, table)), table).toEqual([]);
    // 3つとも同じ1つのまとまりの中にある
    const recordBatches = counting.batches.filter((batch) => batch.some((sql) => LOG_TABLES.some((table) => writesTo(sql, table))));
    expect(recordBatches).toHaveLength(1);
    for (const table of LOG_TABLES) expect(recordBatches[0].some((sql) => writesTo(sql, table)), table).toBe(true);
    // 書いた記録は読み戻せる（まとまりにしても欠けない）
    const fetchId = result.ok ? result.fetchId : "";
    expect((await one<{ n: number }>(ctx.db, "SELECT COUNT(*) AS n FROM fetch_logs WHERE id = ?1", fetchId))?.n).toBe(1);
    expect((await one<{ n: number }>(ctx.db, "SELECT COUNT(*) AS n FROM ai_calls WHERE fetch_id = ?1", fetchId))?.n).toBe(1);
    expect((await one<{ n: number }>(ctx.db, "SELECT COUNT(*) AS n FROM fetch_items WHERE fetch_id = ?1", fetchId))?.n).toBeGreaterThan(0);
  });
});

describe("Google から来た店の座標の手入れと許可書の掃除を預ける（設計-20・安全-20）", () => {
  it("取得のたびに、応答のあとの手入れ2つ（座標の手入れ・usecases/googleUpkeep と許可書の掃除・usecases/licenseSweep）を預ける", async () => {
    const kept: Array<Promise<unknown>> = [];
    const deps: Deps = { ...ctx.deps, defer: (task) => kept.push(task) };
    ctx.geocoder.set("渋谷駅", SHIBUYA);
    await fetchOffers(deps, customerId, { party: 2, place: "渋谷駅" });
    await fetchOffers(deps, customerId, { party: 2, lat: SHIBUYA.lat, lng: SHIBUYA.lng });
    expect(kept).toHaveLength(4);
    await Promise.all(kept);
  });
});

describe("店が自分で書いたメニュー名を引いた選定の理由（不具合-07 のレビュー）", () => {
  it("メニュー名「名物もつ煮」をそのまま引いた理由で、選定の全件が点数順に倒れない", async () => {
    const store = await approvedStore(ctx, { name: "もつ煮の店", genres: ["居酒屋"], menus: ["名物もつ煮"] });
    await publishOffer(store.api, { capacity: 3, partyMax: 4 });
    const reason = "名物もつ煮を出している居酒屋です";
    const ai: AiSelector = { select: async () => ({ ok: true, text: selectionText([{ storeId: store.id, reason }]), costUsd: 0.001 }) };
    const result = await fetchOffers({ ...ctx.deps, ai }, customerId, { party: 2, lat: SHIBUYA.lat, lng: SHIBUYA.lng });

    expect(result.ok).toBe(true);
    const items = result.ok ? result.items : [];
    expect(items.map((item) => ({ storeId: item.storeId, reason: item.reason }))).toEqual([{ storeId: store.id, reason }]);
  });
});
