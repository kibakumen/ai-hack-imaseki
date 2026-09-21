// 要件6 決定論の点数づけと上位10件（純粋・タスク10）。6.6 は r05 の手続きのブロック（タスク11）。
import { expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { loadWeb } from "./_fakes";

const item = (id: string, over: Record<string, unknown> = {}) => ({ id, distanceMeters: 100, storeGenres: ["和食"], createdAt: "2026-09-01T00:00:00.000Z", ...over });

describeTask("10", "点数づけ（純粋）", () => {
  it("6.1・6.2 距離点は 0m→60・400m→30・800m→0 の直線", async () => {
    const { scoreStore } = await loadWeb("lib/domain/score");
    for (const [m, pts] of [[0, 60], [400, 30], [800, 0], [200, 45]] as const) {
      const s = scoreStore({ distanceMeters: m, storeGenres: [], customerGenres: [] });
      expect(s.distancePoints, String(m)).toBeCloseTo(pts, 5);
      expect(s.total).toBeCloseTo(s.distancePoints + s.genrePoints, 5);
    }
  });

  it("6.3 ジャンル点は 40（1つでも重なる）・20（客の好みが空）・0（重ならない）", async () => {
    const { scoreStore } = await loadWeb("lib/domain/score");
    expect(scoreStore({ distanceMeters: 0, storeGenres: ["和食", "居酒屋", "焼肉"], customerGenres: ["焼肉", "中華"] }).genrePoints).toBe(40);
    expect(scoreStore({ distanceMeters: 0, storeGenres: ["和食"], customerGenres: [] }).genrePoints).toBe(20);
    expect(scoreStore({ distanceMeters: 0, storeGenres: ["和食"], customerGenres: ["中華"] }).genrePoints).toBe(0);
    expect(scoreStore({ distanceMeters: 0, storeGenres: ["和食"], customerGenres: ["和食"] }).total).toBe(100);
  });

  it("6.3 その回の好みを使う（登録の好みではない）", async () => {
    const { rankStores } = await loadWeb("lib/domain/score");
    const stores = [item("wa", { storeGenres: ["和食"] }), item("chu", { storeGenres: ["中華"] })];
    expect(rankStores(stores, ["中華"])[0].id).toBe("chu");
    expect(rankStores(stores, ["和食"])[0].id).toBe("wa");
  });

  it("6.4・6.5 点数の高い順（同点なら距離が近い順、さらに同じなら登録が古い順）の上位10件。10件未満はあるだけ", async () => {
    const { rankStores } = await loadWeb("lib/domain/score");
    const stores = Array.from({ length: 15 }, (_, i) => item(`s${i}`, { distanceMeters: 50 * i, storeGenres: i % 2 ? ["和食"] : ["中華"] }));
    const ranked = rankStores(stores, ["和食"]);
    expect(ranked).toHaveLength(10);
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    expect(ranked[0].id).toBe("s1");
    expect(rankStores(stores.slice(0, 3), ["和食"])).toHaveLength(3);
    const tie = rankStores([item("far-old", { distanceMeters: 300, createdAt: "2026-01-01T00:00:00Z" }), item("near-new", { distanceMeters: 100, createdAt: "2026-06-01T00:00:00Z" }), item("near-old", { distanceMeters: 100, createdAt: "2026-01-01T00:00:00Z" })], ["和食"]);
    expect(tie.map((s: any) => s.id)).toEqual(["near-old", "near-new", "far-old"]);
  });

  it("6.7 同じ入力で毎回同じ点数と並び", async () => {
    const { rankStores } = await loadWeb("lib/domain/score");
    const stores = Array.from({ length: 12 }, (_, i) => item(`s${i}`, { distanceMeters: (i * 131) % 800, storeGenres: [i % 3 ? "和食" : "中華"] }));
    const a = JSON.stringify(rankStores(stores, ["和食"]));
    for (let i = 0; i < 5; i++) expect(JSON.stringify(rankStores([...stores].reverse(), ["和食"]))).toBe(a);
  });

  it("4.9 徒歩の分数は 80m→1分・81m→2分・0m→0分（分速80m で切り上げ）", async () => {
    const { walkMinutes } = await loadWeb("lib/domain/geo");
    expect(walkMinutes(80)).toBe(1);
    expect(walkMinutes(81)).toBe(2);
    expect(walkMinutes(0)).toBe(0);
    expect(walkMinutes(800)).toBe(10);
    expect(walkMinutes(799)).toBe(10);
  });

  it("3.6 日本の範囲の判定（北緯20〜46・東経122〜154）", async () => {
    const { inJapan } = await loadWeb("lib/domain/geo");
    expect(inJapan({ lat: 35.6595, lng: 139.7005 })).toBe(true);
    expect(inJapan({ lat: 20, lng: 122 })).toBe(true);
    expect(inJapan({ lat: 46, lng: 154 })).toBe(true);
    expect(inJapan({ lat: 19.99, lng: 139 })).toBe(false);
    expect(inJapan({ lat: 35, lng: 154.01 })).toBe(false);
    expect(inJapan({ lat: 37.77, lng: -122.41 })).toBe(false);
  });
});
