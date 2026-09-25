// 層の約束（監査の指摘 設計-13・2026-09-25）。
//
//   入口（lib/http）   … 見分け・入力の検査・応答の形。SQL を書かない（読み書きは repo を呼ぶ）
//   手続き（usecases） … 規則。HTTP の状態コードを知らず、D1 を直接呼ばない（repo を呼ぶ）
//   repo               … D1 の SQL。変わった行の判定は repo/d1 の changedRows 1つ
//
// 同じ種類の判断が操作ごとに逆を向かないよう、断りの語 → 状態コードの対応は lib/http の表1つに置く。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const LIB = path.resolve(__dirname, "..", "lib");

const sourcesUnder = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourcesUnder(p);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [p] : [];
  });

const offendersIn = (dir: string, pattern: RegExp): string[] =>
  sourcesUnder(path.join(LIB, dir))
    .filter((f) => pattern.test(fs.readFileSync(f, "utf8")))
    .map((f) => path.relative(LIB, f));

describe("層の約束", () => {
  it("入口の層（lib/http）は SQL を書かない", () => {
    expect(offendersIn("http", /\.prepare\(|\b(SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/)).toEqual([]);
  });

  it("手続きの層（lib/usecases）は D1 を直接呼ばない（prepare・batch・exec・文の run は repo の中だけ）", () => {
    expect(offendersIn("usecases", /\bdeps\.db\.(prepare|batch|exec)\(|Statement\([^)]*\)\.run\(/)).toEqual([]);
  });

  it("手続きの層（lib/usecases）は HTTP の状態コードを返さない（断りは種類だけ）", () => {
    expect(offendersIn("usecases", /\bstatus\s*:\s*(?:[1-5]\d\d)\b|\bstatus:\s*\d{3}\s*\|/)).toEqual([]);
  });

  it("断りの語 → 状態コードの対応は lib/http/refusals.ts の表1つにある", async () => {
    const { statusOfRefusal } = await import("../lib/http/refusals");
    expect(statusOfRefusal("invalid_input")).toBe(400);
    expect(statusOfRefusal("unauthenticated")).toBe(401);
    expect(statusOfRefusal("forbidden")).toBe(403);
    expect(statusOfRefusal("not_found")).toBe(404);
    expect(statusOfRefusal("offer_ended")).toBe(409);
    expect(statusOfRefusal("rate_limited")).toBe(429);
    expect(statusOfRefusal("internal")).toBe(500);
  });
});
