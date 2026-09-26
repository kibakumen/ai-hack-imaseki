// 1日1回の定期実行（2026-09-26 本人選択・Service Specific Terms 6.3.1）。
//
// 店の座標の手入れ（usecases/googleUpkeep）は客の取得のついでにしか走らず、客が来ない期間は Google で直した座標が
// 連続30日を超えて残りえた。Cloudflare の Cron Triggers（wrangler.jsonc の triggers.crons）で1日1回、Worker の
// scheduled の入口（web/worker.mjs・OpenNext の「Custom Worker」の形）から lib/scheduled を呼び、30日を過ぎた座標を消す。
// ⚠️ この検査は wrangler を動かさない（本番に触らない）。worker.mjs は組み立てのときにできる .open-next/worker.js を
//    読むので、ここでは中身の決めごとを文字で確かめる。
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeCtx, one, T0, type Ctx } from "../../tests/acceptance/v2/_fakes";
import type { Geocoder } from "../lib/ports";
import { runScheduledJobs } from "../lib/scheduled";

const WEB = path.resolve(__dirname, "..");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number): string => new Date(new Date(T0).getTime() - days * DAY).toISOString();

/** wrangler.jsonc の注（行頭の `//`）を落として読む */
const wranglerConfig = JSON.parse(
  fs
    .readFileSync(path.join(WEB, "wrangler.jsonc"), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n"),
) as { main: string; triggers?: { crons?: string[] } };

describe("定期実行の入口（lib/scheduled）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("30日を過ぎた店の座標を消す（取り直せなかった店）。30日に届かない座標と手で置いた座標は残す", async () => {
    ctx.clock.set(T0);
    const seed = async (id: string, geocodedAt: string | null) =>
      ctx.db.prepare("INSERT INTO stores (id, name, status, address, lat, lng, geocoded_at) VALUES (?1, ?1, 'approved', ?2, 35.6, 139.7, ?3)").bind(id, `住所-${id}`, geocodedAt).run();
    await seed("cron-overdue", ago(31));
    await seed("cron-young", ago(10));
    await seed("cron-hand", null);
    const down: Geocoder = { geocode: async () => ({ ok: false }) };

    await runScheduledJobs({}, () => ({ ...ctx.deps, geocoder: down }));

    expect(await one(ctx.db, "SELECT lat, lng, geocoded_at FROM stores WHERE id = 'cron-overdue'")).toEqual({ lat: null, lng: null, geocoded_at: ago(31) });
    expect(await one(ctx.db, "SELECT lat FROM stores WHERE id = 'cron-young'")).toEqual({ lat: 35.6 });
    expect(await one(ctx.db, "SELECT lat FROM stores WHERE id = 'cron-hand'")).toEqual({ lat: 35.6 });
  });

  it("束縛が無くて手続きを組めなければ、例外を外へ出す（定期実行の失敗として Cloudflare の記録に残す）", async () => {
    await expect(runScheduledJobs({})).rejects.toThrow(/D1/);
  });
});

describe("定期実行の配線（wrangler.jsonc と web/worker.mjs）", () => {
  const worker = fs.readFileSync(path.join(WEB, "worker.mjs"), "utf8");

  it("wrangler.jsonc の入口は web/worker.mjs で、Cron Triggers は1日1回の1本だけ", () => {
    expect(wranglerConfig.main).toBe("./worker.mjs");
    expect(wranglerConfig.triggers?.crons).toHaveLength(1);
    // 分・時が決まった数で、日・月・曜日は毎日（*）
    expect(wranglerConfig.triggers?.crons?.[0]).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
  });

  it("worker.mjs は OpenNext の組み立てた Worker の fetch をそのまま渡し、scheduled で lib/scheduled を waitUntil に預ける", () => {
    expect(worker).toMatch(/import\s+openNextWorker\s+from\s+["']\.\/\.open-next\/worker\.js["']/);
    expect(worker).toMatch(/fetch:\s*openNextWorker\.fetch/);
    expect(worker).toMatch(/import\s+\{\s*runScheduledJobs\s*\}\s+from\s+["']\.\/lib\/scheduled["']/);
    expect(worker).toMatch(/scheduled\s*\([^)]*\)\s*\{[\s\S]*ctx\.waitUntil\(\s*runScheduledJobs\(\s*env\s*\)\s*\)/);
  });
});
