// アプリ全体の1日の地図の上限（2026-09-26 のレビュー・安全-03 の残り・AI判断）。
//
// 連打の抑止は客ごと・接続元ごとに数えるので、接続元を替えれば地図（Geocoding・Places）の請求に天井が無かった。
// Google Cloud の割り当て（README 6.2 の手順7）という手作業だけが頼りだったので、AI の1日の上限と同じ形の天井を
// コードの側にも置く。その日（日本時間）の回数が上限に届いたら、その日の残りは地図を呼ばずに「直せなかった」と
// 同じ倒れ方をする。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeCtx, registerCustomer, type Ctx } from "../../tests/acceptance/v2/_fakes";
import { MAPS_DAILY_CALL_LIMIT } from "../lib/schemas/limits";
import { mapsDailyKey } from "../lib/usecases/mapsBudget";

const T0 = "2026-09-22T06:00:00.000Z";
const DAY_MS = 24 * 60 * 60 * 1000;

describe("安全-03 の残り: アプリ全体の1日の地図の上限", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx({ clockStart: T0 });
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  /** 今日（日本時間）の地図の回数を、上限ちょうどまで使ったことにする */
  const useUpToday = async () => {
    const now = ctx.clock.now();
    await ctx.db
      .prepare("INSERT OR REPLACE INTO rate_counters (key, window_start, count) VALUES (?1, ?2, ?3)")
      .bind(mapsDailyKey(now), now.toISOString(), MAPS_DAILY_CALL_LIMIT)
      .run();
  };

  it("日本時間の日ごとに別の鍵で数える（日本時間の0時で替わる）", () => {
    expect(mapsDailyKey(new Date("2026-09-22T14:59:59.999Z"))).toBe(mapsDailyKey(new Date("2026-09-21T15:00:00.000Z")));
    expect(mapsDailyKey(new Date("2026-09-22T15:00:00.000Z"))).not.toBe(mapsDailyKey(new Date("2026-09-22T14:59:59.999Z")));
  });

  it("上限に届くまでは地図を呼び、呼ぶたびにその日の回数が1つ増える", async () => {
    const c = await registerCustomer(ctx);
    ctx.geocoder.setSuggest("渋谷", ["渋谷駅"]);
    const before = ctx.geocoder.suggestCalls.length;
    const r = await c.api.get("/api/customer/place-suggest?q=%E6%B8%8B%E8%B0%B7");
    expect(r.json.suggestions).toEqual(["渋谷駅"]);
    expect(ctx.geocoder.suggestCalls.length).toBe(before + 1);
    const row = (await ctx.db.prepare("SELECT count FROM rate_counters WHERE key = ?1").bind(mapsDailyKey(ctx.clock.now())).first()) as { count: number } | null;
    expect(row?.count).toBeGreaterThanOrEqual(1);
  });

  it("届いたら、その日の残りは候補・地名・場所の文字での取得のどれも地図を呼ばず、直せなかったときと同じ形で返す。記録に1行残す", async () => {
    await useUpToday();
    const c = await registerCustomer(ctx);
    const calls = { geocode: ctx.geocoder.calls.length, reverse: ctx.geocoder.reverseCalls.length, suggest: ctx.geocoder.suggestCalls.length };
    ctx.geocoder.set("渋谷駅", { lat: 35.658, lng: 139.7016 });

    const suggest = await c.api.get("/api/customer/place-suggest?q=%E6%B8%8B%E8%B0%B7");
    expect(suggest.status).toBe(200);
    expect(suggest.json.suggestions).toEqual([]);
    const place = await c.api.get("/api/customer/place?lat=35.658&lng=139.7016");
    expect(place.status).toBe(200);
    expect(place.json.label).toBeNull();
    const fetched = await c.api.post("/api/customer/fetch", { place: "渋谷駅", party: 2, genres: [], budgetMax: null });
    expect(fetched.status).not.toBe(200);

    expect(ctx.geocoder.calls.length).toBe(calls.geocode);
    expect(ctx.geocoder.reverseCalls.length).toBe(calls.reverse);
    expect(ctx.geocoder.suggestCalls.length).toBe(calls.suggest);
    expect(ctx.logger.entries.some((e) => (e as { event?: string }).event === "maps_daily_limit_reached")).toBe(true);
  });

  it("次の日（日本時間）はまた呼ぶ", async () => {
    await useUpToday();
    await ctx.clock.advance(DAY_MS);
    const c = await registerCustomer(ctx);
    const before = ctx.geocoder.reverseCalls.length;
    const place = await c.api.get("/api/customer/place?lat=35.658&lng=139.7016");
    expect(place.json.label).not.toBeNull();
    expect(ctx.geocoder.reverseCalls.length).toBe(before + 1);
  });
});
