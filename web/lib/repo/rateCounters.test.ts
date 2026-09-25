// 連打の抑止の数え（repo/rateCounters）を、手元の D1（wrangler の getPlatformProxy・本物の SQLite）で見る。
//
// 以前の検査は rate_counters を真似た偽の Map で数えていて、「読んでから書く」の2往復が同時の要求で
// すり抜けることを原理的に見られなかった（安全-02）。ここは本物の文を本物の SQLite に流す。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../../../tests/acceptance/v2/_fakes";
import type { D1Database } from "./d1";
import { deleteRateCounter, hitRateCounter, refundRateCounter } from "./rateCounters";

const T0 = "2026-09-22T06:00:00.000Z";
const MIN = 60_000;
const at = (minutes: number) => new Date(Date.parse(T0) + minutes * MIN).toISOString();

describe("repo/rateCounters（手元の D1）", () => {
  let db: Db;
  let dispose: () => Promise<void>;
  const d1 = () => db as unknown as D1Database;
  const rowOf = async (key: string) => db.prepare("SELECT window_start, count FROM rate_counters WHERE key = ?1").bind(key).first();

  beforeAll(async () => {
    ({ db, dispose } = await openDb());
  });
  afterAll(async () => {
    await dispose();
  });

  it("行が無ければ1回目として入れ、窓は今から始まる", async () => {
    expect(await hitRateCounter(d1(), "t:new", { nowIso: at(0), windowMs: MIN, limit: 3 })).toEqual({ windowStartIso: at(0), count: 1 });
  });

  it("窓の中では1足し、窓の始まりは動かさない（上限に届く回までは）", async () => {
    await hitRateCounter(d1(), "t:inc", { nowIso: at(0), windowMs: MIN, limit: 3 });
    expect(await hitRateCounter(d1(), "t:inc", { nowIso: at(0.5), windowMs: MIN, limit: 3 })).toEqual({ windowStartIso: at(0), count: 2 });
  });

  it("上限に届いた回は、その時刻へ窓を貼り直す。超えた回は数だけ増え、窓は延びない", async () => {
    const hit = (m: number) => hitRateCounter(d1(), "t:stamp", { nowIso: at(m), windowMs: MIN, limit: 3 });
    await hit(0);
    await hit(0.2);
    expect(await hit(0.5)).toEqual({ windowStartIso: at(0.5), count: 3 });
    expect(await hit(0.9)).toEqual({ windowStartIso: at(0.5), count: 4 });
    expect(await hit(1.4)).toEqual({ windowStartIso: at(0.5), count: 5 });
    // 貼り直した時刻から窓の長さちょうどで明ける
    expect(await hit(1.5)).toEqual({ windowStartIso: at(1.5), count: 1 });
  });

  it("窓の始まりが日付として読めない行・今より後の行は、新しい窓として数え直す（フェイルオープン）", async () => {
    await db.prepare("INSERT INTO rate_counters (key, window_start, count) VALUES ('t:broken', 'こわれた値', 99), ('t:future', ?1, 99)").bind(at(60)).run();
    expect(await hitRateCounter(d1(), "t:broken", { nowIso: at(0), windowMs: MIN, limit: 3 })).toEqual({ windowStartIso: at(0), count: 1 });
    expect(await hitRateCounter(d1(), "t:future", { nowIso: at(0), windowMs: MIN, limit: 3 })).toEqual({ windowStartIso: at(0), count: 1 });
  });

  it("安全-02: 同じ鍵へ同時に20本足しても、返る回数は1〜20が1つずつ（読んでから書く隙が無い）", async () => {
    const hits = await Promise.all(Array.from({ length: 20 }, () => hitRateCounter(d1(), "t:race", { nowIso: at(0), windowMs: MIN, limit: 5 })));
    expect(hits.map((h) => h.count).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect((await rowOf("t:race"))?.count).toBe(20);
  });

  it("返すのは、足したときと同じ窓のときだけ1引く。消すと行が無くなる", async () => {
    const first = await hitRateCounter(d1(), "t:refund", { nowIso: at(0), windowMs: MIN, limit: 5 });
    await hitRateCounter(d1(), "t:refund", { nowIso: at(0.1), windowMs: MIN, limit: 5 });
    await refundRateCounter(d1(), "t:refund", first.windowStartIso);
    expect((await rowOf("t:refund"))?.count).toBe(1);
    // 違う窓の値では引かない
    await refundRateCounter(d1(), "t:refund", at(30));
    expect((await rowOf("t:refund"))?.count).toBe(1);
    await deleteRateCounter(d1(), "t:refund");
    expect(await rowOf("t:refund")).toBeNull();
  });

  it("migration 0003 のあと、rate_counters の主キーは key だけ（同じ鍵の行は1つにしか置けない）", async () => {
    const columns = (await db.prepare("PRAGMA table_info(rate_counters)").all()).results as Array<{ name: string; pk: number }>;
    expect(columns.filter((c) => c.pk > 0).map((c) => c.name)).toEqual(["key"]);
  });
});
