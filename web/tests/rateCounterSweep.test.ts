// 数えの表 rate_counters の片付け（2026-09-26 独立したレビューの指摘・AI判断）。
//
// 連打の抑止・回線ごとの AI の取り分・地図の1日の上限・端末の印は、どれも rate_counters に鍵ごとの1行を置く。
// 鍵に接続元や日付を含むもの（`aiLineDaily:<IP>:<日>`・`fetchIp:<IP>` など）は、接続元が変わるたび・日が変わるたびに
// 新しい行が増え、窓が明けても行は消えなかった。1日1回の定期実行（lib/scheduled）で、いちばん長い窓より古い行を消す。
//
// いちばん長い窓は、実際に使われている規則を全部見て決める（ここで見張る）:
//   - 入口の抑止の規則（lib/http/rateLimits の表）
//   - 回線ごとの AI の取り分・地図の1日の上限（2日の窓）・営業許可書の掃除と Google の手入れの間引き・店の画像の埋め戻し
//   - 端末の印の信頼期間（30日・repo/loginDevices。窓の始まり＝最後に通った時刻として同じ列を読む）
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeCtx, one, T0, type Ctx } from "../../tests/acceptance/v2/_fakes";
import { rateLimitedRoutes, rateRulesFor } from "../lib/http/rateLimits";
import type { Geocoder } from "../lib/ports";
import { runScheduledJobs } from "../lib/scheduled";
import { LOGIN_DEVICE_TRUST_MS, RATE_COUNTER_RETENTION_MS, STORE_IMAGE_BACKFILL_WINDOW_MS } from "../lib/schemas/limits";
import { COUNTER_WINDOW_MS as AI_LINE_WINDOW_MS } from "../lib/usecases/aiLineShare";
import { UPKEEP_WINDOW_MS } from "../lib/usecases/googleUpkeep";
import { SWEEP_WINDOW_MS as LICENSE_SWEEP_WINDOW_MS } from "../lib/usecases/licenseSweep";
import { COUNTER_WINDOW_MS as MAPS_WINDOW_MS } from "../lib/usecases/mapsBudget";

const LIB = path.resolve(__dirname, "..", "lib");
const DAY = 24 * 60 * 60 * 1000;
const agoMs = (ms: number): string => new Date(new Date(T0).getTime() - ms).toISOString();

const sourcesUnder = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourcesUnder(p);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [p] : [];
  });

describe("数えの表を残す長さ（いちばん長い窓）", () => {
  it("入口の抑止の規則・回線ごとの AI の取り分・地図の上限・間引き・端末の印の信頼期間の、どの窓よりも短くない", () => {
    const ruleWindows = rateLimitedRoutes().flatMap((route) => {
      const [method, routePath] = route.split(" ");
      return rateRulesFor(method, routePath).map((rule) => rule.windowMs);
    });
    const windows = [...ruleWindows, AI_LINE_WINDOW_MS, MAPS_WINDOW_MS, LICENSE_SWEEP_WINDOW_MS, UPKEEP_WINDOW_MS, STORE_IMAGE_BACKFILL_WINDOW_MS, LOGIN_DEVICE_TRUST_MS];
    expect(ruleWindows.length).toBeGreaterThan(0);
    expect(RATE_COUNTER_RETENTION_MS).toBe(Math.max(...windows));
  });

  it("rate_counters を数える・書く場所は、上で窓を確かめた場所だけ（新しく足したら、ここに窓を足す）", () => {
    const writers = sourcesUnder(LIB)
      .filter((file) => /hitRateCounter\(|INSERT INTO rate_counters/.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(LIB, file))
      .sort();
    expect(writers).toEqual([
      "http/rateLimits.ts",
      "repo/loginDevices.ts",
      "repo/rateCounters.ts",
      "usecases/aiLineShare.ts",
      "usecases/googleUpkeep.ts",
      "usecases/licenseSweep.ts",
      "usecases/mapsBudget.ts",
      "usecases/storeImage.ts",
    ]);
  });
});

describe("1日1回の定期実行で、いちばん長い窓より古い数えの行を消す", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  const seedCounter = (key: string, windowStart: string) =>
    ctx.db.prepare("INSERT INTO rate_counters (key, window_start, count) VALUES (?1, ?2, 1)").bind(key, windowStart).run();
  const counter = (key: string) => one(ctx.db, "SELECT window_start FROM rate_counters WHERE key = ?1", key);

  it("接続元×日の行（aiLineDaily など）は、いちばん長い窓を過ぎたら消え、窓の中の行（端末の印の29日目など）は残る", async () => {
    ctx.clock.set(T0);
    await seedCounter("aiLineDaily:203.0.113.9:2026-08-01", agoMs(RATE_COUNTER_RETENTION_MS + DAY));
    await seedCounter("fetchIp:203.0.113.9", agoMs(RATE_COUNTER_RETENTION_MS));
    await seedCounter("loginDevice:owner@example.com|abc", agoMs(RATE_COUNTER_RETENTION_MS - DAY));
    await seedCounter("aiLineDaily:203.0.113.9:2026-09-22", agoMs(DAY));
    const down: Geocoder = { geocode: async () => ({ ok: false }) };
    const logged: Array<{ event: string; count?: number }> = [];

    await runScheduledJobs({}, () => ({ ...ctx.deps, geocoder: down, logger: { log: (entry) => logged.push(entry) } }));

    expect(await counter("aiLineDaily:203.0.113.9:2026-08-01")).toBeNull();
    expect(await counter("fetchIp:203.0.113.9")).toBeNull();
    expect(await counter("loginDevice:owner@example.com|abc")).not.toBeNull();
    expect(await counter("aiLineDaily:203.0.113.9:2026-09-22")).not.toBeNull();
    expect(logged).toContainEqual({ event: "rate_counters_swept", count: 2 });
  });

  it("店の座標の手入れが落ちても、数えの片付けは走らせ、そのあと例外を外へ出す（定期実行の失敗として残す）", async () => {
    ctx.clock.set(T0);
    await seedCounter("placeIp:198.51.100.7", agoMs(RATE_COUNTER_RETENTION_MS + DAY));
    const db = ctx.deps.db;
    // 店の座標を消す文だけを落とす（D1 の一部が落ちた場面）
    const brokenDb = { ...db, prepare: (sql: string) => (/UPDATE stores SET lat = NULL/.test(sql) ? (() => { throw new Error("D1 が落ちた"); })() : db.prepare(sql)) } as typeof db;

    await expect(runScheduledJobs({}, () => ({ ...ctx.deps, db: brokenDb }))).rejects.toThrow("D1 が落ちた");
    expect(await counter("placeIp:198.51.100.7")).toBeNull();
  });

  it("消した行が無い日は記録に残さない", async () => {
    const logged: Array<{ event: string }> = [];
    await runScheduledJobs({}, () => ({ ...ctx.deps, logger: { log: (entry) => logged.push(entry) } }));
    expect(logged.map((entry) => entry.event)).not.toContain("rate_counters_swept");
  });
});
