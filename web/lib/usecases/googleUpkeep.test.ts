// Google の地図サービスの利用条件に沿わせる手入れ（2026-09-25 監査の指摘 設計-20 の案1）。
//   ①Google で位置に直した店の座標は、30日を過ぎる前に取り直す（取り直せないまま30日を過ぎたら消す）
//   ②場所の文字を Google で位置に直した取得の起点（fetch_logs）は、30日を過ぎたら約1kmの粗さに丸める
//   ③手入れは1時間に1回まで・応答のあとに（deps.defer）走らせる
// 手で置いた座標（デモの店）と、端末の現在地から取った起点は Google の中身ではないので触らない。
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approvedStore, makeCtx, one, T0, type Ctx } from "../../../tests/acceptance/v2/_fakes";
import type { Deps, Geocoder } from "../ports";
import { runGoogleUpkeep, scheduleGoogleUpkeep } from "./googleUpkeep";

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number): string => new Date(new Date(T0).getTime() - days * DAY).toISOString();

let ctx: Ctx;
beforeAll(async () => {
  ctx = await makeCtx();
});
afterAll(async () => {
  await ctx.dispose();
});

let seq = 0;
const seedStore = async (input: { address: string; lat: number | null; lng: number | null; geocodedAt: string | null }): Promise<string> => {
  const id = `store-upkeep-${++seq}`;
  await ctx.db
    .prepare(`INSERT INTO stores (id, name, status, address, lat, lng, geocoded_at) VALUES (?1, ?2, 'approved', ?3, ?4, ?5, ?6)`)
    .bind(id, `手入れの店${seq}`, input.address, input.lat, input.lng, input.geocodedAt)
    .run();
  return id;
};
const seedFetchLog = async (input: { at: string; source: string | null; lat: number; lng: number }): Promise<string> => {
  const id = `fetch-upkeep-${++seq}`;
  await ctx.db
    .prepare(
      `INSERT INTO fetch_logs (id, customer_id, origin_lat, origin_lng, party, genres, budget_max, candidate_count, returned_count, ai_used, duration_ms, at, origin_source)
       VALUES (?1, 'customer-upkeep', ?2, ?3, 2, '[]', NULL, 1, 1, 1, 100, ?4, ?5)`,
    )
    .bind(id, input.lat, input.lng, input.at, input.source)
    .run();
  return id;
};
const storeRow = (id: string) => one<{ lat: number | null; lng: number | null; geocoded_at: string | null }>(ctx.db, "SELECT lat, lng, geocoded_at FROM stores WHERE id = ?1", id);
const originOf = (id: string) => one<{ origin_lat: number; origin_lng: number }>(ctx.db, "SELECT origin_lat, origin_lng FROM fetch_logs WHERE id = ?1", id);

/** 住所ごとの答えを持つ偽の地図（呼ばれた住所を覚える） */
const tableGeocoder = (table: Record<string, { lat: number; lng: number } | "none">) => {
  const asked: string[] = [];
  const geocoder: Geocoder = {
    geocode: async (text) => {
      asked.push(text);
      const answer = table[text] ?? "none";
      return answer === "none" ? { ok: false } : { ok: true, lat: answer.lat, lng: answer.lng };
    },
  };
  return { geocoder, asked };
};

beforeEach(async () => {
  ctx.clock.set(T0);
  // 手入れの間引き（1時間に1回）を検査ごとに解く
  await ctx.db.prepare("DELETE FROM rate_counters WHERE key LIKE 'upkeep:%'").run();
});

describe("Google で位置に直した店の座標（30日まで）", () => {
  it("25日を過ぎた座標は取り直し、新しい座標と時刻で書き換える。まだ新しい座標と手で置いた座標（取った時刻が無い）には聞かない", async () => {
    const stale = await seedStore({ address: "住所-古い", lat: 35.1, lng: 139.1, geocodedAt: ago(26) });
    const fresh = await seedStore({ address: "住所-新しい", lat: 35.2, lng: 139.2, geocodedAt: ago(10) });
    const handPlaced = await seedStore({ address: "住所-手置き", lat: 35.3, lng: 139.3, geocodedAt: null });
    const { geocoder, asked } = tableGeocoder({ "住所-古い": { lat: 35.6595, lng: 139.7005 } });
    await runGoogleUpkeep({ ...ctx.deps, geocoder });

    expect(asked).toContain("住所-古い");
    expect(asked).not.toContain("住所-新しい");
    expect(asked).not.toContain("住所-手置き");
    expect(await storeRow(stale)).toEqual({ lat: 35.6595, lng: 139.7005, geocoded_at: T0 });
    expect(await storeRow(fresh)).toEqual({ lat: 35.2, lng: 139.2, geocoded_at: ago(10) });
    expect(await storeRow(handPlaced)).toEqual({ lat: 35.3, lng: 139.3, geocoded_at: null });
  });

  it("取り直せなかった座標は、30日を過ぎるまでは残して次の回にまた試す。30日を過ぎたら座標を消す（店は住所を保存し直すまで探す結果に出ない）", async () => {
    const retry = await seedStore({ address: "住所-直らない-27日", lat: 35.4, lng: 139.4, geocodedAt: ago(27) });
    const expired = await seedStore({ address: "住所-直らない-31日", lat: 35.5, lng: 139.5, geocodedAt: ago(31) });
    const { geocoder } = tableGeocoder({});
    await runGoogleUpkeep({ ...ctx.deps, geocoder });

    expect(await storeRow(retry)).toEqual({ lat: 35.4, lng: 139.4, geocoded_at: ago(27) });
    expect(await storeRow(expired)).toEqual({ lat: null, lng: null, geocoded_at: null });
  });
});

describe("取得の起点（fetch_logs）の座標", () => {
  it("30日を過ぎた起点のうち、Google で位置に直したもの（と、どちらか分からない古い行）だけを約1kmに丸める。端末の現在地と30日以内の行は触らない", async () => {
    const oldPlace = await seedFetchLog({ at: ago(31), source: "place", lat: 35.659512, lng: 139.700456 });
    const oldUnknown = await seedFetchLog({ at: ago(40), source: null, lat: 35.681236, lng: 139.767125 });
    const oldDevice = await seedFetchLog({ at: ago(31), source: "device", lat: 35.659512, lng: 139.700456 });
    const newPlace = await seedFetchLog({ at: ago(1), source: "place", lat: 35.659512, lng: 139.700456 });
    await runGoogleUpkeep(ctx.deps);

    expect(await originOf(oldPlace)).toEqual({ origin_lat: 35.66, origin_lng: 139.7 });
    expect(await originOf(oldUnknown)).toEqual({ origin_lat: 35.68, origin_lng: 139.77 });
    expect(await originOf(oldDevice)).toEqual({ origin_lat: 35.659512, origin_lng: 139.700456 });
    expect(await originOf(newPlace)).toEqual({ origin_lat: 35.659512, origin_lng: 139.700456 });
  });
});

describe("手入れの走らせ方", () => {
  it("1時間に1回まで。2回目は何もせず、1時間を過ぎたらまた走る", async () => {
    const { geocoder, asked } = tableGeocoder({ "住所-間引き": { lat: 35.6, lng: 139.6 } });
    const deps: Deps = { ...ctx.deps, geocoder };
    await runGoogleUpkeep(deps);
    await seedStore({ address: "住所-間引き", lat: 35.1, lng: 139.1, geocodedAt: ago(26) });
    await runGoogleUpkeep(deps);
    expect(asked).not.toContain("住所-間引き");
    ctx.clock.set(new Date(new Date(T0).getTime() + 61 * 60 * 1000).toISOString());
    await runGoogleUpkeep(deps);
    expect(asked).toContain("住所-間引き");
  });

  it("応答のあとに走らせる口（deps.defer）があるときだけ預け、無ければ走らせない（取得の応答を待たせない）", async () => {
    const kept: Array<Promise<unknown>> = [];
    scheduleGoogleUpkeep({ ...ctx.deps, defer: (task) => kept.push(task) });
    expect(kept).toHaveLength(1);
    await kept[0];
    expect(() => scheduleGoogleUpkeep(ctx.deps)).not.toThrow();
  });

  it("手入れが落ちても例外を外へ出さない（記録に1行残す）", async () => {
    const broken: Deps = { ...ctx.deps, db: { ...ctx.deps.db, prepare: () => { throw new Error("D1 が落ちた"); } } as Deps["db"] };
    await expect(runGoogleUpkeep(broken)).resolves.toBeUndefined();
  });
});

describe("店の情報の保存（住所を Google で位置に直したとき）", () => {
  it("位置に直した時刻を geocoded_at に残す（30日の手入れの起点になる）", async () => {
    ctx.clock.set(T0);
    const store = await approvedStore(ctx, { name: "保存の店" });
    expect((await storeRow(store.id))?.geocoded_at).toBe(T0);
  });
});
