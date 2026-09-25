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
    const geocoder: Geocoder = {
      geocode: async () => {
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

    const armed = ctx.clock.armed();
    const pending = fetchOffers(deps, customerId, { party: 2, place: "渋谷駅" });
    await armed;
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

describe("起点の出どころを記録に残す（設計-20: Google の中身かどうかで、30日の手入れの対象を分ける）", () => {
  it("場所の文字を位置に直した起点は 'place'、端末の現在地は 'device' として残り、応答のあとの手入れを預ける", async () => {
    const kept: Array<Promise<unknown>> = [];
    const deps: Deps = { ...ctx.deps, defer: (task) => kept.push(task) };
    ctx.geocoder.set("渋谷駅", SHIBUYA);
    const byPlace = await fetchOffers(deps, customerId, { party: 2, place: "渋谷駅" });
    const byDevice = await fetchOffers(deps, customerId, { party: 2, lat: SHIBUYA.lat, lng: SHIBUYA.lng });
    const sourceOf = async (result: typeof byPlace) =>
      (await one<{ origin_source: string | null }>(ctx.db, "SELECT origin_source FROM fetch_logs WHERE id = ?1", result.ok ? result.fetchId : ""))?.origin_source;
    expect(await sourceOf(byPlace)).toBe("place");
    expect(await sourceOf(byDevice)).toBe("device");
    // 取得ごとに手入れを1つ預ける（走るのは1時間に1回まで・usecases/googleUpkeep）
    expect(kept).toHaveLength(2);
    await Promise.all(kept);
  });
});
