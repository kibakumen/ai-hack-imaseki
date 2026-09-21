// 点数づけと並べ替え（要件6）のうち、受け入れ検査（r06）が見ない端を固定する。
// 800m の外の距離が来たときの収め方と、点数・距離・登録の古さが全部同じときの順（基準 6.7 の
// 「毎回同じ並び」を、入力の並びが変わっても保てるか）。
import { describe, expect, it } from "vitest";
import { rankStores, scoreStore } from "../../lib/domain/score";

const item = (id: string, over: Partial<{ distanceMeters: number; storeGenres: string[]; createdAt: string }> = {}) => ({
  id,
  distanceMeters: 100,
  storeGenres: ["和食"],
  createdAt: "2026-09-01T00:00:00.000Z",
  ...over,
});

describe("点数づけ", () => {
  it("距離が800m の外・負でも、距離点は 0〜60 に収まる", () => {
    expect(scoreStore({ distanceMeters: 1200, storeGenres: [], customerGenres: [] }).distancePoints).toBe(0);
    expect(scoreStore({ distanceMeters: -50, storeGenres: [], customerGenres: [] }).distancePoints).toBe(60);
  });

  it("店のジャンルが空なら、好みが選ばれている限りジャンル点は0", () => {
    expect(scoreStore({ distanceMeters: 0, storeGenres: [], customerGenres: ["和食"] }).genrePoints).toBe(0);
    expect(scoreStore({ distanceMeters: 0, storeGenres: [], customerGenres: [] }).genrePoints).toBe(20);
  });
});

describe("並べ替え", () => {
  it("点数・距離・登録の古さが全部同じなら店の番号の順。入力の並びを変えても同じ答え", () => {
    const items = [item("c"), item("a"), item("b")];
    expect(rankStores(items, ["和食"]).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(rankStores([...items].reverse(), ["和食"]).map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("渡された配列も、その中の行も書き換えない（点数は写しに足す）", () => {
    const items = [item("a"), item("b", { distanceMeters: 300 })];
    const before = JSON.stringify(items);
    const ranked = rankStores(items, ["和食"]);
    expect(JSON.stringify(items)).toBe(before);
    expect(ranked[0]).toMatchObject({ id: "a", score: 92.5 });
  });

  it("登録の時刻が読めない行は、同点・同距離のときに後ろへ回る", () => {
    const ranked = rankStores([item("broken", { createdAt: "なし" }), item("old", { createdAt: "2026-01-01T00:00:00Z" })], ["和食"]);
    expect(ranked.map((s) => s.id)).toEqual(["old", "broken"]);
  });
});
