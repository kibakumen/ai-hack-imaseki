// 公開の手順（2026-09-25 監査の指摘 設計-01）。
//
// 0002 のときは、列が無いまま公開して本番が500になった（公開のスクリプトが migration を当てなかった）。
// ここは「公開の前に本番の D1 へ migration を当てる」が手順に入っていることと、本番に当たった migration を
// 後から書き換えていないことを見張る（適用済みの 0001 を書き換えた前例がある・239db4f）。
// ⚠️ この検査は手順の中身を見るだけで、wrangler を動かさない（本番に触らない）。
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { rateKeyFor, rateRulesFor } from "../lib/http/rateLimits";

const WEB = path.resolve(__dirname, "..");
const README = fs.readFileSync(path.join(WEB, "..", "README.md"), "utf8");
/** README の「6. 公開の手順」の節（次の `## ` まで） */
const deploySection = README.slice(README.indexOf("## 6. 公開の手順"), README.indexOf("\n## 7."));
const scripts = (JSON.parse(fs.readFileSync(path.join(WEB, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
/** wrangler.jsonc の注（`//`）を落として読む（文字列の中に `//` を含む行は無い前提の簡単な読み方） */
const wranglerConfig = JSON.parse(
  fs
    .readFileSync(path.join(WEB, "wrangler.jsonc"), "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n"),
) as {
  d1_databases: Array<{ binding: string; database_name: string }>;
  observability?: { enabled?: boolean; redact_query_string?: boolean; logs?: { invocation_logs?: boolean } };
  workers_dev?: boolean;
  preview_urls?: boolean;
};

describe("公開の手順（設計-01）", () => {
  it("deploy は、組み立てのあと・公開の前に、本番の D1 へ migration を当てる", () => {
    const deploy = scripts.deploy;
    const dbName = wranglerConfig.d1_databases.find((d) => d.binding === "DB")!.database_name;
    const steps = deploy.split("&&").map((s) => s.trim());
    // 公開を止めている間の歯止め（下の「公開を止めている間」）が、ほかのどの手順よりも先に立つ
    expect(steps[0], deploy).toBe(DEPLOY_GUARD_STEP);
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

  // 2026-09-26 のレビュー: `observability.enabled` だけだと呼び出しごとの記録（invocation logs）が既定で有効になり、
  // 要求の URL を問い合わせ文字列ごと残す。`GET /api/customer/place?lat=…&lng=…` の客の座標と、
  // `GET /api/customer/place-suggest?q=…` の打った場所の文字が Workers Logs に載る（要件27・/privacy と食い違う）。
  it("記録は、呼び出しごとの記録を切り、URL の問い合わせ文字列を伏せる（客の座標と打った場所を Workers Logs に残さない）", () => {
    expect(wranglerConfig.observability?.logs?.invocation_logs).toBe(false);
    expect(wranglerConfig.observability?.redact_query_string).toBe(true);
  });

  it("本番に当たった migration（0001・0002）の中身は変わっていない。変えるときは新しい番号の migration を足す", () => {
    const hashOf = (name: string) => createHash("sha256").update(fs.readFileSync(path.join(WEB, "migrations", name))).digest("hex");
    expect(hashOf("0001_init.sql")).toBe("2aaf8800d6ddc8a5ff556a5eccaa2673674eb23358fbd3f6662459937a8f4f4d");
    expect(hashOf("0002_ai_call_purpose.sql")).toBe("e706fa59a624e11d76115415781e13fa46a61ee422b5f3bbd3d8ef3f5c70a479");
  });

  // レビューの指摘: deploy が本番の D1 を書き換えるようになったのに、README は「ビルド→wrangler deploy の順」のままだった
  it("README の6節に、deploy が本番の D1 へ migration を当てること・当てる前の確かめ・適用済みを書き換えない決まりが在る", () => {
    expect(deploySection.length).toBeGreaterThan(0);
    expect(deploySection).toContain(scripts["migrate:remote"]);
    expect(deploySection).toContain("wrangler d1 migrations list ai-hack-v2 --remote");
    expect(deploySection).toContain("本番に当たった migration は書き換えない");
  });

  // 安全-10: どの案でも、締め出しを解く手順を README に書く。鍵の形がコードと食い違うと、書いた手順が何も消さない
  it("README の締め出しを解く手順は、今のログインの数えの鍵の形（login:<email>|… と loginIp:<接続元>）を消す", () => {
    const [loginRule, loginIpRule] = rateRulesFor("POST", "/api/auth/login");
    const accountKey = rateKeyFor(loginRule, { ip: "203.0.113.5", customerId: null, input: { email: "a@example.com" } });
    const ipKey = rateKeyFor(loginIpRule, { ip: "203.0.113.5", customerId: null, input: { email: "a@example.com" } });
    expect(accountKey).toBe("login:a@example.com|203.0.113.5");
    expect(ipKey).toBe("loginIp:203.0.113.5");
    expect(deploySection).toContain("DELETE FROM rate_counters WHERE key LIKE 'login:<メールアドレス>|%'");
    expect(deploySection).toContain("DELETE FROM rate_counters WHERE key = 'loginIp:<接続元>'");
  });

  it("migration の番号は重ならない（同じ番号の2本は、当てる順が名前の並びに任され、事故のもとになる）", () => {
    const numbers = fs
      .readdirSync(path.join(WEB, "migrations"))
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.slice(0, 4));
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});

// 2026-09-26 のレビュー（本人の依頼「安全のために一旦デプロイは止めて」）: 止めたのは管理画面の手だけで、設定に
// 残っていなかった。`pnpm --dir web run deploy` を1回流すだけで workers.dev の公開が戻り、本番の D1 に migration も当たった。
const DEPLOY_GUARD_STEP = "node scripts/deploy-guard.mjs";

describe("公開を止めている間（2026-09-26）", () => {
  const runGuard = (env: Record<string, string>) =>
    spawnSync(process.execPath, [path.join(WEB, "scripts", "deploy-guard.mjs")], { env: { PATH: process.env.PATH ?? "", ...env }, encoding: "utf8" });

  it("wrangler.jsonc は workers.dev と版ごとの下見の URL を出さない（次の wrangler deploy で公開が黙って戻らない）", () => {
    expect(wranglerConfig.workers_dev).toBe(false);
    expect(wranglerConfig.preview_urls).toBe(false);
  });

  it("deploy の歯止めは、明示の合図（ALLOW_DEPLOY=1）が無ければ失敗で止まり、理由と再開の手順の場所を出す", () => {
    const refused = runGuard({});
    expect(refused.status).not.toBe(0);
    expect(refused.stderr).toContain("ALLOW_DEPLOY=1");
    expect(refused.stderr).toContain("README");
    expect(runGuard({ ALLOW_DEPLOY: "yes" }).status).not.toBe(0);
    expect(runGuard({ ALLOW_DEPLOY: "1" }).status).toBe(0);
  });

  it("README の6節は、合図つきの deploy と、workers.dev を戻すかの判断を再開の手順に書いている", () => {
    expect(deploySection).toContain("ALLOW_DEPLOY=1 pnpm --dir web run deploy");
    expect(deploySection).toContain("workers_dev");
  });
});
