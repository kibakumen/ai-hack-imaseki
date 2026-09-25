// 成功した応答の形の表（監査の指摘 設計-07・設計-09・2026-09-25）。
//   - JSON を返す入口は全部、表に形が載っている（載せ忘れた入口は、画面が形を確かめずに読む）
//   - 表の鍵は全部、実在する入口（綴りを間違えた鍵は、どの応答も確かめない）
//   - 画面の束に入るファイルは zod（大きい版）を値として読まない（約40言語の文言が画面の JS に入る）
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTE_DEFINITIONS } from "../lib/http/routes";
import { NON_JSON_ROUTES, RESPONSES } from "../lib/schemas/responses";

const WEB = path.resolve(__dirname, "..");

const sourcesUnder = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourcesUnder(p);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [p] : [];
  });

/** `import ... from "zod"`（値として。`import type` は除く）。 */
const importsFullZod = (text: string): boolean => /^\s*import\s+(?!type\s)[^'"]*from\s+['"]zod['"]/m.test(text);

describe("成功した応答の形の表", () => {
  const routeKeys = ROUTE_DEFINITIONS.map((r) => `${r.method} ${r.path}`);

  it("JSON を返す入口は全部、表に形が載っている", () => {
    const missing = routeKeys.filter((key) => !(NON_JSON_ROUTES as readonly string[]).includes(key) && !(key in RESPONSES));
    expect(missing).toEqual([]);
  });

  it("入口の成功は全部 respond（形の表で確かめる道）を通る。手で組んだ 2xx の本文が無い（ファイル・少しずつ届く本文を除く）", () => {
    const offenders = sourcesUnder(path.join(WEB, "lib", "http", "endpoints")).flatMap((f) =>
      (fs.readFileSync(f, "utf8").match(/status:\s*2\d\d,\s*body:(?!\s*null,\s*raw)[^\n]*/g) ?? []).map((m) => `${path.basename(f)}: ${m}`),
    );
    expect(offenders).toEqual([]);
  });

  it("表の鍵と、JSON でない入口の一覧は、全部が実在する入口で、重ならない", () => {
    expect(Object.keys(RESPONSES).filter((key) => !routeKeys.includes(key))).toEqual([]);
    expect(NON_JSON_ROUTES.filter((key) => !routeKeys.includes(key))).toEqual([]);
    expect(NON_JSON_ROUTES.filter((key) => key in RESPONSES)).toEqual([]);
  });
});

describe("画面の束に zod の大きい版を入れない（設計-09）", () => {
  it("components・app・lib/client・schemas/responses・domain/texts が zod を値として読まない（読むなら zod/mini から名前で）", () => {
    const files = [
      ...sourcesUnder(path.join(WEB, "components")),
      ...sourcesUnder(path.join(WEB, "app")).filter((f) => !f.includes(`${path.sep}api${path.sep}`)),
      ...sourcesUnder(path.join(WEB, "lib", "client")),
      path.join(WEB, "lib", "schemas", "responses.ts"),
      path.join(WEB, "lib", "schemas", "limits.ts"),
      path.join(WEB, "lib", "domain", "texts.ts"),
    ];
    const offenders = files.filter((f) => importsFullZod(fs.readFileSync(f, "utf8"))).map((f) => path.relative(WEB, f));
    expect(offenders).toEqual([]);
  });

  it("zod/mini は名前を指定して読む（名前空間 `* as z` で読むと、文言の束ごと入りうる）", () => {
    const files = [...sourcesUnder(path.join(WEB, "lib", "client")), path.join(WEB, "lib", "schemas", "responses.ts")];
    const offenders = files.filter((f) => /import\s+\*\s+as\s+\w+\s+from\s+['"]zod\/mini['"]|import\s+\{\s*z\s*\}\s+from\s+['"]zod\/mini['"]/.test(fs.readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
