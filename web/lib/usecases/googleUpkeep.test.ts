// Google の地図サービスの利用条件に沿わせる手入れ（2026-09-25 監査の指摘 設計-20 の案1）。
//   ①Google で位置に直した店の座標は、30日を過ぎる前に取り直す（取り直せないまま30日を過ぎたら消す）
//   ②消す理由を分ける: 住所が位置に直らない（0件・日本の外）なら取り直しをやめ、外の障害なら座標だけを消して
//     取り直しを続け、戻ったら座標も戻す（外の一時的な障害を、元に戻らないデータの欠けにしない・レビューの指摘）
//   ③0009 より前に保存した店も、登録の時刻を起点に手入れの対象へ入れる（デモの店は入れない・レビューの指摘）
//   ④手入れは1時間に1回まで・応答のあとに（deps.defer）走らせる
//   ⑤30日を過ぎた座標は件数の上限なしで全部消し、1日1回の定期実行でも間引きに関わらず消す（2026-09-26 本人選択）
// 手で置いた座標（デモの店）は Google の中身ではないので触らない。取得の起点（fetch_logs）はここでは触らない——
// Google から得た座標はもう書かず、既にある行は migration 0016 が1回だけ消した（2026-09-26 本人選択）。
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { approvedStore, makeCtx, one, splitSql, T0, WEB, type Ctx } from "../../../tests/acceptance/v2/_fakes";
import type { Deps, Geocoder } from "../ports";
import { runGoogleUpkeep, runScheduledGoogleUpkeep, scheduleGoogleUpkeep } from "./googleUpkeep";

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
const storeRow = (id: string) => one<{ lat: number | null; lng: number | null; geocoded_at: string | null }>(ctx.db, "SELECT lat, lng, geocoded_at FROM stores WHERE id = ?1", id);

/**
 * 住所ごとの答えを持つ偽の地図（呼ばれた住所を覚える）。
 * "none" は住所が位置に直らない（Google の ZERO_RESULTS）、"down" は外の障害（打ち切り・通信の失敗・5xx）。
 * 表に無い住所は "none"。
 */
const tableGeocoder = (table: Record<string, { lat: number; lng: number } | "none" | "down">) => {
  const asked: string[] = [];
  const geocoder: Geocoder = {
    geocode: async (text) => {
      asked.push(text);
      const answer = table[text] ?? "none";
      if (answer === "none") return { ok: false, notFound: true };
      if (answer === "down") return { ok: false };
      return { ok: true, lat: answer.lat, lng: answer.lng };
    },
  };
  return { geocoder, asked };
};

beforeEach(async () => {
  ctx.clock.set(T0);
  // 手入れの間引き（1時間に1回）を検査ごとに解く
  await ctx.db.prepare("DELETE FROM rate_counters WHERE key LIKE 'upkeep:%'").run();
  // 前の検査の店を取り直しの列から外す（1回に取り直す数の上限を、検査ごとの店だけで使う）
  await ctx.db.prepare("UPDATE stores SET geocoded_at = NULL").run();
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

  it("取り直せなかった座標は、30日を過ぎるまでは残して次の回にまた試す", async () => {
    const notFound = await seedStore({ address: "住所-直らない-27日", lat: 35.4, lng: 139.4, geocodedAt: ago(27) });
    const down = await seedStore({ address: "住所-障害-27日", lat: 35.41, lng: 139.41, geocodedAt: ago(27) });
    const { geocoder } = tableGeocoder({ "住所-障害-27日": "down" });
    await runGoogleUpkeep({ ...ctx.deps, geocoder });

    expect(await storeRow(notFound)).toEqual({ lat: 35.4, lng: 139.4, geocoded_at: ago(27) });
    expect(await storeRow(down)).toEqual({ lat: 35.41, lng: 139.41, geocoded_at: ago(27) });
  });

  it("住所が位置に直らない（0件・日本の外）まま30日を過ぎたら座標を消し、取り直しもやめる（店が住所を保存し直すまで探す結果に出ない）", async () => {
    const notFound = await seedStore({ address: "住所-直らない-31日", lat: 35.5, lng: 139.5, geocodedAt: ago(31) });
    const abroad = await seedStore({ address: "住所-日本の外-31日", lat: 35.51, lng: 139.51, geocodedAt: ago(31) });
    const logged: Array<{ event: string; id?: string | number; errorKind?: string }> = [];
    const { geocoder } = tableGeocoder({ "住所-日本の外-31日": { lat: 48.8566, lng: 2.3522 } });
    await runGoogleUpkeep({ ...ctx.deps, geocoder, logger: { log: (entry) => logged.push(entry) } });

    expect(await storeRow(notFound)).toEqual({ lat: null, lng: null, geocoded_at: null });
    expect(await storeRow(abroad)).toEqual({ lat: null, lng: null, geocoded_at: null });
    expect(logged).toContainEqual({ event: "store_coordinates_expired", id: notFound, errorKind: "not_found" });
    expect(logged).toContainEqual({ event: "store_coordinates_expired", id: abroad, errorKind: "not_found" });
  });

  it("外の障害のまま30日を過ぎたら座標だけを消して取り直しを続け、障害が明けたら座標を戻す（一時的な障害を元に戻らない欠けにしない）", async () => {
    const store = await seedStore({ address: "住所-障害-31日", lat: 35.6, lng: 139.6, geocodedAt: ago(31) });
    const logged: Array<{ event: string; id?: string | number; errorKind?: string }> = [];
    const down = tableGeocoder({ "住所-障害-31日": "down" });
    await runGoogleUpkeep({ ...ctx.deps, geocoder: down.geocoder, logger: { log: (entry) => logged.push(entry) } });

    // 利用条件の30日は守る（座標は消す）。取った時刻は残して、次の回も取り直しの対象にする
    expect(await storeRow(store)).toEqual({ lat: null, lng: null, geocoded_at: ago(31) });
    expect(logged).toContainEqual({ event: "store_coordinates_expired", id: store, errorKind: "unavailable" });

    // 障害が明けた次の回（1時間後）に、住所から取り直して座標を戻す
    ctx.clock.set(new Date(new Date(T0).getTime() + 61 * 60 * 1000).toISOString());
    const recovered = tableGeocoder({ "住所-障害-31日": { lat: 35.6012, lng: 139.6034 } });
    await runGoogleUpkeep({ ...ctx.deps, geocoder: recovered.geocoder });
    expect(recovered.asked).toContain("住所-障害-31日");
    expect(await storeRow(store)).toEqual({ lat: 35.6012, lng: 139.6034, geocoded_at: ctx.clock.now().toISOString() });
  });

  it("座標を消した店の取り直しで住所が位置に直らないと分かったら、取り直しをやめる", async () => {
    const store = await seedStore({ address: "住所-消えたあと直らない", lat: null, lng: null, geocodedAt: ago(40) });
    const { geocoder } = tableGeocoder({});
    await runGoogleUpkeep({ ...ctx.deps, geocoder });
    expect(await storeRow(store)).toEqual({ lat: null, lng: null, geocoded_at: null });
  });

  it("座標がまだ在る店を、座標を消した店より先に取り直す（1回に取り直す数を、期限が迫っている店に使う）", async () => {
    const erased = await Promise.all(
      Array.from({ length: 5 }, (_, i) => seedStore({ address: `住所-消えた-${i}`, lat: null, lng: null, geocodedAt: ago(60 + i) })),
    );
    const atRisk = await seedStore({ address: "住所-期限が迫る", lat: 35.7, lng: 139.7, geocodedAt: ago(29) });
    const { geocoder, asked } = tableGeocoder(Object.fromEntries([...erased.map((_, i) => [`住所-消えた-${i}`, "down" as const]), ["住所-期限が迫る", { lat: 35.7001, lng: 139.7001 }]]));
    await runGoogleUpkeep({ ...ctx.deps, geocoder });

    expect(asked[0]).toBe("住所-期限が迫る");
    expect(await storeRow(atRisk)).toEqual({ lat: 35.7001, lng: 139.7001, geocoded_at: T0 });
  });
});

// 2026-09-26 本人選択: 手入れは客の取得のときにしか走らず、1回に5件までだったので、客が来ない期間や店が多い日には
// 30日を超えて座標が残りえた（Service Specific Terms 6.3.1 は連続30日を過ぎたら消すことを求める）。
// 消す方は件数の上限を置かずに1つの文で全部消し、1日1回の定期実行（Worker の scheduled・web/worker.mjs）でも走らせる。
describe("30日を過ぎた座標は、取り直しの数の上限と間引きに関わらず必ず消す", () => {
  it("取り直しの上限（1回に5件）を超えて30日を過ぎた店が並んでいても、全部の座標を消す。取った時刻は残して取り直しを続ける", async () => {
    const overdue = await Promise.all(Array.from({ length: 8 }, (_, i) => seedStore({ address: `住所-大量-${i}`, lat: 35.1 + i / 100, lng: 139.1, geocodedAt: ago(31 + i) })));
    const young = await seedStore({ address: "住所-29日", lat: 35.9, lng: 139.9, geocodedAt: ago(29) });
    const handPlaced = await seedStore({ address: "住所-手置き-古い", lat: 35.8, lng: 139.8, geocodedAt: null });
    const { geocoder, asked } = tableGeocoder(Object.fromEntries(overdue.map((_, i) => [`住所-大量-${i}`, "down" as const])));
    await runGoogleUpkeep({ ...ctx.deps, geocoder });

    expect(asked.length).toBeLessThanOrEqual(5);
    for (const [i, id] of overdue.entries()) expect(await storeRow(id)).toEqual({ lat: null, lng: null, geocoded_at: ago(31 + i) });
    expect(await storeRow(young)).toEqual({ lat: 35.9, lng: 139.9, geocoded_at: ago(29) });
    expect(await storeRow(handPlaced)).toEqual({ lat: 35.8, lng: 139.8, geocoded_at: null });
  });

  it("定期実行の手入れは、1時間の間引きに当たっても30日を過ぎた座標を消す（取り直しは間引きに従う）", async () => {
    const { geocoder, asked } = tableGeocoder({});
    await runGoogleUpkeep({ ...ctx.deps, geocoder }); // 客の取得のついでの回（これで1時間の間引きに入る）
    const overdue = await seedStore({ address: "住所-定期-31日", lat: 35.2, lng: 139.2, geocodedAt: ago(31) });
    const logged: Array<{ event: string; count?: number }> = [];
    await runScheduledGoogleUpkeep({ ...ctx.deps, geocoder, logger: { log: (entry) => logged.push(entry) } });

    expect(asked).not.toContain("住所-定期-31日");
    expect(await storeRow(overdue)).toEqual({ lat: null, lng: null, geocoded_at: ago(31) });
    expect(logged).toContainEqual({ event: "store_coordinates_swept", count: 1 });
  });

  it("定期実行の手入れは、消せなかったら例外を外へ出す（定期実行の失敗として Cloudflare の記録に残す）", async () => {
    const broken: Deps = { ...ctx.deps, db: { ...ctx.deps.db, prepare: () => { throw new Error("D1 が落ちた"); } } as Deps["db"] };
    await expect(runScheduledGoogleUpkeep(broken)).rejects.toThrow();
  });
});

describe("0009 より前に Google で位置に直した店（レビューの指摘: 取った時刻が無く、手入れから外れていた）", () => {
  const MIGRATION = path.join(WEB, "migrations", "0009_google_terms.sql");
  /** 0009 の埋め戻しの文だけを流し直す（列を足す文は、検査の D1 には既に当たっている） */
  const rerunBackfill = async (): Promise<void> => {
    for (const statement of splitSql(fs.readFileSync(MIGRATION, "utf8")).filter((sql) => /^UPDATE\b/i.test(sql))) await ctx.db.prepare(statement).run();
  };
  const seedStoreWithAccount = async (input: { email: string; lat: number | null; createdAt: string; geocodedAt?: string | null }): Promise<string> => {
    const id = await seedStore({ address: `住所-${input.email}`, lat: input.lat, lng: input.lat === null ? null : 139.0, geocodedAt: input.geocodedAt ?? null });
    await ctx.db.prepare("UPDATE stores SET created_at = ?2 WHERE id = ?1").bind(id, input.createdAt).run();
    await ctx.db
      .prepare("INSERT INTO accounts (id, email, password_hash, role, store_id) VALUES (?1, ?2, 'x', 'store', ?3)")
      .bind(`account-${id}`, input.email, id)
      .run();
    return id;
  };

  it("座標のある店の取った時刻を、店の登録の時刻で埋める（それより前には取っていないので、若く見積もらない）。デモの店（@example.com）・座標の無い店・時刻が既に在る店は触らない", async () => {
    const registered = "2026-09-21T03:00:00.000Z";
    const real = await seedStoreWithAccount({ email: "owner@izakaya-before-0009.jp", lat: 35.1, createdAt: registered });
    const demo = await seedStoreWithAccount({ email: "demo-store-9@example.com", lat: 35.2, createdAt: registered });
    const noCoordinates = await seedStoreWithAccount({ email: "owner@no-coords.jp", lat: null, createdAt: registered });
    const stamped = await seedStoreWithAccount({ email: "owner@stamped.jp", lat: 35.3, createdAt: registered, geocodedAt: ago(3) });
    await rerunBackfill();

    expect((await storeRow(real))?.geocoded_at).toBe(registered);
    expect((await storeRow(demo))?.geocoded_at).toBeNull();
    expect((await storeRow(noCoordinates))?.geocoded_at).toBeNull();
    expect((await storeRow(stamped))?.geocoded_at).toBe(ago(3));
  });

  it("埋めた店は、登録から25日を過ぎていれば次の手入れで取り直される", async () => {
    const old = await seedStoreWithAccount({ email: "owner@old-before-0009.jp", lat: 35.4, createdAt: ago(26) });
    await rerunBackfill();
    const { geocoder, asked } = tableGeocoder({ "住所-owner@old-before-0009.jp": { lat: 35.4001, lng: 139.0001 } });
    await runGoogleUpkeep({ ...ctx.deps, geocoder });

    expect(asked).toContain("住所-owner@old-before-0009.jp");
    expect(await storeRow(old)).toEqual({ lat: 35.4001, lng: 139.0001, geocoded_at: T0 });
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
