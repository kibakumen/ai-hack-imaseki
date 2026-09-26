/* eslint-disable @typescript-eslint/no-explicit-any -- 場面と応答は、この検査の中だけで読む値（受け入れ検査の _fakes と同じ扱い） */
// 回線ごとの AI の取り分（2026-09-26 本人選択・安全-03 の残り・要件30の補足）。
//
// 1つの接続元（回線。IPv6 は /64 に丸める）が、その日（日本時間）にアプリ全体の1日の AI の回数上限の2割を使ったら、
// その回線からの取得では紹介文の AI を呼ばず、決まった文へ倒す。選定の AI はアプリ全体の上限だけに従う（取り分では止めない）。
// 数えは連打の抑止と同じ表（rate_counters）の1行を、1回ごとに1つの文で足す（読んでから書く競合を作らない）。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvedStore, makeCtx, one, publishOffer, registerCustomer, spot, type Ctx } from "../../tests/acceptance/v2/_fakes";
import { AI_DAILY_CALL_LIMIT, AI_LINE_DAILY_CALL_LIMIT, AI_LINE_DAILY_SHARE } from "../lib/schemas/limits";
import { aiLineDailyKey, aiLineMeter } from "../lib/usecases/aiLineShare";

const T0 = "2026-09-22T06:00:00.000Z";

describe("回線ごとの AI の取り分", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx({ clockStart: T0 });
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  /** その回線の今日の数えを、上限の手前まで進めておく（1文で入れる） */
  const presetLine = async (ip: string, count: number) => {
    await ctx.db
      .prepare(`INSERT OR REPLACE INTO rate_counters (key, window_start, count) VALUES (?1, ?2, ?3)`)
      .bind(aiLineDailyKey(ip, ctx.clock.now()), ctx.clock.now().toISOString(), count)
      .run();
  };
  const lineCount = async (ip: string): Promise<number> => Number((await one(ctx.db, "SELECT count FROM rate_counters WHERE key = ?", aiLineDailyKey(ip, ctx.clock.now())))?.count ?? 0);

  /** 店を1つ公開して、指定の接続元の客1人で少しずつ届く取得を1回 */
  const streamFrom = async (ip: string) => {
    const at = spot();
    const store = await approvedStore(ctx, { name: "取り分の店", coupons: [], ...at });
    await publishOffer(store.api, { capacity: 3, partyMax: 4, couponIds: [] });
    const customer = await registerCustomer(ctx);
    const api = ctx.api(customer.api.cookie, { ip });
    // 偽の時計は進めずに最後まで読む（店は1つなので、紹介文の着手のずらしも全体の蓋も待たない）。
    // 時計を進めながら読む道具（fetchOffersStream）は、D1 を待つ間に1店の割り振り（15秒）を使い切ることがある
    const res = await api.open("POST", "/api/customer/fetch/stream", { party: 2, genres: [], budgetMax: null, ...at });
    const text = await res.text();
    const lines = text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line));
    return { status: res.status, lines };
  };

  it("取り分はアプリ全体の1日の回数上限の2割（名前つきの定数）", () => {
    expect(AI_LINE_DAILY_SHARE).toBe(0.2);
    expect(AI_LINE_DAILY_CALL_LIMIT).toBe(Math.floor(AI_DAILY_CALL_LIMIT * 0.2));
  });

  it("取り分を使い切った回線の取得は、紹介文の AI を1回も呼ばずに決まった文へ倒れ、選定の AI は呼ぶ", async () => {
    const ip = "203.0.113.71";
    await presetLine(ip, AI_LINE_DAILY_CALL_LIMIT);
    const pitchBefore = ctx.pitch.total();
    const aiBefore = ctx.ai.calls.length;
    const result = await streamFrom(ip);
    expect(result.status).toBe(200);
    const pitches = result.lines.filter((l: any) => l.type === "pitch");
    expect(pitches.length).toBeGreaterThan(0);
    expect(pitches.every((l: any) => l.source === "fallback")).toBe(true);
    expect(ctx.pitch.total()).toBe(pitchBefore);
    expect(ctx.ai.calls.length).toBe(aiBefore + 1);
  });

  it("取り分が残っている別の回線は、紹介文の AI を呼び、使った回数（選定1回＋紹介文の呼び出し）がその回線に数わる", async () => {
    const ip = "203.0.113.72";
    // 決定論のガードと検査官に通る文を書く偽の書き手（既定の文は語の検査で落ちうる）
    ctx.pitch.respondWrite(() => ({ ok: true, text: "歩いて4分、今日は刺身盛りを出してるよ", costUsd: 0.0004, truncated: false }));
    const pitchBefore = ctx.pitch.total();
    const result = await streamFrom(ip);
    expect(result.status).toBe(200);
    expect(result.lines.filter((l: any) => l.type === "pitch").some((l: any) => l.source === "persona")).toBe(true);
    expect(ctx.pitch.total()).toBeGreaterThan(pitchBefore);
    expect(await lineCount(ip)).toBe(1 + (ctx.pitch.total() - pitchBefore));
  });

  it("数えは1文で足す: 残り3回の回線へ10本同時に頼んでも、通るのは3本だけ", async () => {
    const ip = "203.0.113.73";
    await presetLine(ip, AI_LINE_DAILY_CALL_LIMIT - 3);
    const meter = aiLineMeter(ctx.deps, ip)!;
    const answers = await Promise.all(Array.from({ length: 10 }, () => meter.take()));
    expect(answers.filter(Boolean)).toHaveLength(3);
  });

  it("IPv6 は /64 で1つの回線として数え、日本時間の日が替われば数え直す", async () => {
    await presetLine("2001:db8:1:2::1", AI_LINE_DAILY_CALL_LIMIT);
    expect(await aiLineMeter(ctx.deps, "2001:db8:1:2:aaaa::1")!.take()).toBe(false);
    expect(await aiLineMeter(ctx.deps, "2001:db8:1:3::1")!.take()).toBe(true);
    // 日本時間の 0 時（UTC 15:00）を過ぎると、同じ回線でもまた呼べる
    ctx.clock.set("2026-09-22T15:00:00.000Z");
    expect(await aiLineMeter(ctx.deps, "2001:db8:1:2:aaaa::1")!.take()).toBe(true);
    ctx.clock.set(T0);
  });

  it("接続元が分からない要求（手元の開発など）では取り分を数えない", () => {
    expect(aiLineMeter(ctx.deps, null)).toBeNull();
    expect(aiLineMeter(ctx.deps, "")).toBeNull();
  });
});
