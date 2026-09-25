// D1 の型と、repo が共有する2つの道具（JSON の文字列の並びを読む・変わった行を数える）の検査
// （監査の指摘 設計-14「D1 の型が any のままで、道具が7つと2つに写されている」）。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { Deps } from "../ports";
import { changedRows, parseStringList, type D1Database } from "./d1";

const LIB = path.resolve(__dirname, "..");

const sourcesUnder = (dir: string): string[] =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourcesUnder(p);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [p] : [];
    });

describe("parseStringList（列に入っている JSON の文字列の並び）", () => {
  it("文字列の並びはそのまま読む", () => {
    expect(parseStringList('["和食","寿司・海鮮"]')).toEqual(["和食", "寿司・海鮮"]);
  });

  it("文字列でない要素は落とす", () => {
    expect(parseStringList('["a",1,null,{"x":1},"b"]')).toEqual(["a", "b"]);
  });

  it("壊れた JSON・並びでない JSON・文字列でない値は空として読む（画面を止めない）", () => {
    expect(parseStringList("{ not json")).toEqual([]);
    expect(parseStringList('{"a":1}')).toEqual([]);
    expect(parseStringList('"a"')).toEqual([]);
    expect(parseStringList(null)).toEqual([]);
    expect(parseStringList(undefined)).toEqual([]);
    expect(parseStringList(42)).toEqual([]);
  });
});

describe("changedRows（書き込みで変わった行の数）", () => {
  it("D1 が返した数をそのまま返す", () => {
    expect(changedRows({ results: [], success: true, meta: { changes: 2 } })).toBe(2);
    expect(changedRows({ results: [], success: true, meta: { changes: 0 } })).toBe(0);
  });

  it("数が分からないときは 0（＝変わっていない）へ倒す——断る側に倒す1つの判定", () => {
    expect(changedRows({ results: [], success: true, meta: {} })).toBe(0);
    expect(changedRows(null)).toBe(0);
    expect(changedRows(undefined)).toBe(0);
    expect(changedRows({ results: [], success: true, meta: { changes: "3" as unknown as number } })).toBe(0);
  });
});

describe("D1 の型と道具の置き場所", () => {
  it("Deps.db は any ではなく D1Database の型を持つ（.first() と .all() の取り違えを型検査が拾う）", () => {
    expectTypeOf<Deps["db"]>().not.toBeAny();
    expectTypeOf<Deps["db"]>().toEqualTypeOf<D1Database>();
  });

  it("repo と usecases と http に、変わった行の数え（meta.changes）と JSON の並びの読みの写しが無い", () => {
    const offenders = [...sourcesUnder(path.join(LIB, "repo")), ...sourcesUnder(path.join(LIB, "usecases")), ...sourcesUnder(path.join(LIB, "http"))]
      .filter((f) => path.basename(f) !== "d1.ts")
      .filter((f) => {
        const text = fs.readFileSync(f, "utf8");
        return /meta\??\.changes/.test(text) || /JSON\.parse\([^)]*\)[\s\S]{0,80}Array\.isArray/.test(text);
      })
      .map((f) => path.relative(LIB, f));
    expect(offenders).toEqual([]);
  });
});
