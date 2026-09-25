// 公開の手順（2026-09-25 監査の指摘 設計-01）。
//
// 0002 のときは、列が無いまま公開して本番が500になった（公開のスクリプトが migration を当てなかった）。
// ここは「公開の前に本番の D1 へ migration を当てる」が手順に入っていることと、本番に当たった migration を
// 後から書き換えていないことを見張る（適用済みの 0001 を書き換えた前例がある・239db4f）。
// ⚠️ この検査は手順の中身を見るだけで、wrangler を動かさない（本番に触らない）。
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WEB = path.resolve(__dirname, "..");
const scripts = (JSON.parse(fs.readFileSync(path.join(WEB, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
/** wrangler.jsonc の注（`//`）を落として読む（文字列の中に `//` を含む行は無い前提の簡単な読み方） */
const wranglerConfig = JSON.parse(
  fs
    .readFileSync(path.join(WEB, "wrangler.jsonc"), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n"),
) as { d1_databases: Array<{ binding: string; database_name: string }>; observability?: { enabled?: boolean } };

describe("公開の手順（設計-01）", () => {
  it("deploy は、組み立てのあと・公開の前に、本番の D1 へ migration を当てる", () => {
    const deploy = scripts.deploy;
    const dbName = wranglerConfig.d1_databases.find((d) => d.binding === "DB")!.database_name;
    const steps = deploy.split("&&").map((s) => s.trim());
    const migrate = steps.findIndex((s) => s === "pnpm run migrate:remote");
    const build = steps.findIndex((s) => s.startsWith("opennextjs-cloudflare build"));
    const publish = steps.findIndex((s) => s.startsWith("wrangler deploy"));
    expect(migrate, deploy).toBeGreaterThan(-1);
    expect(build, deploy).toBeGreaterThan(-1);
    expect(publish, deploy).toBeGreaterThan(-1);
    expect(build).toBeLessThan(migrate);
    expect(migrate).toBeLessThan(publish);
    expect(scripts["migrate:remote"]).toBe(`wrangler d1 migrations apply ${dbName} --remote`);
  });

  it("wrangler.jsonc で記録（observability）を有効にしている（本番の500や連打に後から気づけるように）", () => {
    expect(wranglerConfig.observability?.enabled).toBe(true);
  });

  it("本番に当たった migration（0001・0002）の中身は変わっていない。変えるときは新しい番号の migration を足す", () => {
    const hashOf = (name: string) => createHash("sha256").update(fs.readFileSync(path.join(WEB, "migrations", name))).digest("hex");
    expect(hashOf("0001_init.sql")).toBe("2aaf8800d6ddc8a5ff556a5eccaa2673674eb23358fbd3f6662459937a8f4f4d");
    expect(hashOf("0002_ai_call_purpose.sql")).toBe("e706fa59a624e11d76115415781e13fa46a61ee422b5f3bbd3d8ef3f5c70a479");
  });

  it("migration の番号は重ならない（同じ番号の2本は、当てる順が名前の並びに任され、事故のもとになる）", () => {
    const numbers = fs
      .readdirSync(path.join(WEB, "migrations"))
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.slice(0, 4));
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
