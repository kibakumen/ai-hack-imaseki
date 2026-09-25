// 鍵の道具 `scripts/v2-keys.sh` が、Worker の秘密へ送ってよいものだけを送ること（2026-09-25 の監査の直しの続き）。
//
// 安全-23 の直しで、手元の web/.dev.vars は Turnstile の試験用の鍵（答えを必ず通す公開の値）を置く形になった。
// ところが `push` は .dev.vars の全部の行を Worker の秘密へ送り、`put` も手元と Cloudflare の両方へ同じ値を入れていた。
// そのまま使うと、試験用の秘密鍵が本番へ上がり、本番の人の確かめが素通しになる（README 7.4 が禁じている形）。
// 手元にだけ置く `TURNSTILE_SITE_KEY` まで秘密として送られ、`vars` の同じ名前とぶつかる。
//
// ⚠️ この検査は本物の web/.dev.vars を読まない。道具を一時フォルダへ写し、偽の .dev.vars と、送った中身を
//    ファイルへ書くだけの偽の `pnpm` で走らせる（Cloudflare には触らない）。
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = path.resolve(__dirname, "..", "..", "scripts", "v2-keys.sh");
const TEST_SECRET = "1x0000000000000000000000000000000AA";

type Sandbox = { root: string; capture: string; env: NodeJS.ProcessEnv };
const sandboxes: string[] = [];

const makeSandbox = (devVars: string): Sandbox => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "v2-keys-"));
  sandboxes.push(root);
  fs.mkdirSync(path.join(root, "scripts"));
  fs.mkdirSync(path.join(root, "web"));
  fs.mkdirSync(path.join(root, "bin"));
  fs.copyFileSync(SCRIPT, path.join(root, "scripts", "v2-keys.sh"));
  fs.writeFileSync(path.join(root, "web", ".dev.vars"), devVars);
  fs.writeFileSync(path.join(root, ".gitignore"), "web/.dev.vars\n.dev/\n");
  execFileSync("git", ["init", "-q"], { cwd: root });
  const capture = path.join(root, "sent.txt");
  // 偽の pnpm: 標準入力（送ろうとした秘密）と引数をファイルへ書くだけ
  fs.writeFileSync(path.join(root, "bin", "pnpm"), `#!/bin/sh\necho "$*" >> "${capture}.args"\ncat >> "${capture}"\n`, { mode: 0o755 });
  return { root, capture, env: { ...process.env, PATH: `${path.join(root, "bin")}:${process.env.PATH ?? ""}` } };
};

const run = (box: Sandbox, args: string[], input = "") =>
  spawnSync("bash", [path.join(box.root, "scripts", "v2-keys.sh"), ...args], { cwd: box.root, env: box.env, input, encoding: "utf8" });

const sentOf = (box: Sandbox): string | null => (fs.existsSync(box.capture) ? fs.readFileSync(box.capture, "utf8") : null);

afterEach(() => {
  for (const dir of sandboxes.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("scripts/v2-keys.sh: Worker の秘密へ送ってよいものだけを送る", () => {
  it("push は秘密の6つの名前だけを送り、手元にだけ置く TURNSTILE_SITE_KEY は送らない", () => {
    const box = makeSandbox(['ORCAROUTER_API_KEY="dummy-orca"', 'TURNSTILE_SITE_KEY="1x00000000000000000000AA"', 'TURNSTILE_SECRET_KEY="0xdummy-prod-like"', ""].join("\n"));
    const result = run(box, ["push"]);
    expect(result.status, result.stderr).toBe(0);
    const sent = JSON.parse(sentOf(box) ?? "{}") as Record<string, string>;
    expect(Object.keys(sent).sort()).toEqual(["ORCAROUTER_API_KEY", "TURNSTILE_SECRET_KEY"]);
  });

  it("push は、Turnstile の秘密鍵が試験用の鍵（1x・2x・3x で始まる）なら何も送らずに止まる", () => {
    const box = makeSandbox(['ORCAROUTER_API_KEY="dummy-orca"', `TURNSTILE_SECRET_KEY="${TEST_SECRET}"`, ""].join("\n"));
    const result = run(box, ["push"]);
    expect(result.status).not.toBe(0);
    expect(sentOf(box)).toBeNull();
    expect(result.stderr).toMatch(/試験用/);
  });

  it("put で Turnstile の試験用の秘密鍵を入れると、手元には入るが Cloudflare へは送らない", () => {
    const box = makeSandbox("");
    const result = run(box, ["put", "TURNSTILE_SECRET_KEY"], `${TEST_SECRET}\n`);
    expect(result.status, result.stderr).toBe(0);
    expect(fs.readFileSync(path.join(box.root, "web", ".dev.vars"), "utf8")).toContain(`TURNSTILE_SECRET_KEY="${TEST_SECRET}"`);
    expect(sentOf(box)).toBeNull();
  });
});
