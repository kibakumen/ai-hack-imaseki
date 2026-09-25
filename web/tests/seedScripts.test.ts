// 手で流す種データのスクリプト（web/scripts/*.mjs）が、本番へ貼る文を出せるか（2026-09-25 安全-01 のレビュー）。
//
// スクリプトは .mjs なので型の検査を通らない。repo の関数の名前が変わったとき（設計-14）に seed-demo.mjs だけが
// 古い名前を呼び続け、流した瞬間に落ちる形になっていた。ここで `--print`（何も実行せず、貼る文を出すだけ。
// D1 にも外にも触れない）を実際に走らせて、読み込みから文の組み立てまでが通ることを見る。

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const run = promisify(execFile);
const SCRIPTS = path.resolve(__dirname, "..", "scripts");
const PASSWORD = "print-only-pass-1234";
const TIMEOUT_MS = 60_000;

const print = async (script: string, args: string[]): Promise<string[]> => {
  const { stdout } = await run(process.execPath, [path.join(SCRIPTS, script), ...args, "--print"], { timeout: TIMEOUT_MS });
  return stdout.split("\n").filter((line) => line.trim() !== "");
};

const PREFIX = "pnpm --dir web exec wrangler d1 execute ai-hack-v2 --remote --command ";
const commandsOf = (lines: string[]) => lines.filter((line) => line.startsWith("pnpm "));
/** 貼るコマンドから、wrangler に渡る SQL を取り出す（単一引用の1語。中の ' は '\'' で出る）。本物の bash での確かめは下の1本。 */
const sqlsOf = (lines: string[]): string[] =>
  commandsOf(lines).map((command) => {
    expect(command.startsWith(PREFIX)).toBe(true);
    const word = command.slice(PREFIX.length);
    expect(word.startsWith("'") && word.endsWith("'")).toBe(true);
    return word.slice(1, -1).replace(/'\\''/g, "'");
  });
const LIST_ADMINS = "SELECT id, email FROM accounts WHERE role = 'admin' ORDER BY email";

describe("seed-demo.mjs --print", () => {
  const demoArgs = ["--admin-email", "demo-admin@example.com", "--admin-password", PASSWORD, "--store-password", PASSWORD];

  it(
    "今いる運営を確かめる文を先頭に出し、店6軒の登録・承認・クーポン・オファーの文を続ける",
    async () => {
      const commands = sqlsOf(await print("seed-demo.mjs", demoArgs));
      expect(commands[0]).toBe(LIST_ADMINS);
      expect(commands.filter((c) => c.includes("INSERT INTO stores"))).toHaveLength(6);
      expect(commands.filter((c) => c.includes("UPDATE stores SET status = 'approved'"))).toHaveLength(6);
      expect(commands.filter((c) => c.includes("INSERT INTO offers"))).toHaveLength(6);
      expect(commands.some((c) => c.includes("'admin'") && c.includes("INSERT INTO accounts"))).toBe(true);
    },
    TIMEOUT_MS,
  );

  it(
    "運営の番号を指せば、2人目を作る文ではなく、その運営を取り返す文（メールアドレスとパスワードの入れ替え・セッションを全部切る）を出す",
    async () => {
      const commands = sqlsOf(await print("seed-demo.mjs", [...demoArgs, "--admin-account-id", "admin-acc-1"]));
      expect(commands[0]).toBe(LIST_ADMINS);
      expect(commands.some((c) => c.includes("UPDATE accounts SET email = 'demo-admin@example.com' WHERE id = 'admin-acc-1'"))).toBe(true);
      expect(commands.some((c) => c.includes("DELETE FROM sessions WHERE account_id = 'admin-acc-1'"))).toBe(true);
      expect(commands.some((c) => c.includes("INSERT INTO accounts") && c.includes("'admin'"))).toBe(false);
    },
    TIMEOUT_MS,
  );
});

// 2026-09-26 のレビュー: README の「本番のデモ店のパスワードを入れ替えるとき」は、保存の値を手で写して
// `--command "UPDATE … '<その値>' …"` と二重引用で流す形だった。貼った bash が `$1…` や `$<塩>` を展開して
// `pbkdf2-sha25600000…` のような壊れた値が入り、審査員がデモ店に入れなくなる。文を出すのもスクリプトに任せ、
// 運営の側と同じ単一引用の形（print-sql の remoteCommand）を通す。
describe("seed-demo.mjs --rotate-stores --print", () => {
  const rotateArgs = ["--rotate-stores", "--store-password", PASSWORD];
  const DEMO_EMAILS = [1, 2, 3, 4, 5, 6].map((n) => `demo-store-${n}@example.com`);

  it(
    "デモ店のパスワードの入れ替えとセッションの削除の2文だけを出す（店・オファー・運営には触れない）",
    async () => {
      const commands = sqlsOf(await print("seed-demo.mjs", rotateArgs));
      expect(commands).toHaveLength(2);
      const [update, remove] = commands;
      expect(update).toMatch(/^UPDATE accounts SET password_hash = 'pbkdf2-sha256\$100000\$[^']+', must_change_password = 0 WHERE role = 'store' AND email IN \(/);
      expect(remove).toMatch(/^DELETE FROM sessions WHERE account_id IN \(SELECT id FROM accounts WHERE role = 'store' AND email IN \(/);
      for (const email of DEMO_EMAILS) {
        expect(update).toContain(`'${email}'`);
        expect(remove).toContain(`'${email}'`);
      }
      expect(commands.some((c) => /INSERT|stores|offers|'admin'/.test(c))).toBe(false);
    },
    TIMEOUT_MS,
  );

  it(
    "出したコマンドを bash に貼っても、パスワードの保存の値（$ を含む）が崩れずに wrangler へ渡る",
    async () => {
      const update = commandsOf(await print("seed-demo.mjs", rotateArgs)).find((c) => c.includes("UPDATE accounts"))!;
      const { stdout } = await run("bash", ["-c", `printf '%s' ${update.slice(PREFIX.length)}`], { timeout: TIMEOUT_MS });
      expect(stdout).toMatch(/password_hash = 'pbkdf2-sha256\$100000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+'/);
    },
    TIMEOUT_MS,
  );
});

describe("seed-admin.mjs --print", () => {
  // パスワードの保存の形は `pbkdf2-sha256$100000$<塩>$<値>`。二重引用で出すと、貼った bash が `$1…` や `$<塩>` を
  // 変数として展開し、壊れた値が本番に入る（取り返したつもりの運営に、誰も入れなくなる）。
  it(
    "出したコマンドを bash に貼っても、パスワードの保存の値（$ を含む）が崩れずに wrangler へ渡る",
    async () => {
      const commands = commandsOf(await print("seed-admin.mjs", ["--email", "admin@example.com", "--password", PASSWORD]));
      const insert = commands.find((c) => c.includes("INSERT INTO accounts"))!;
      expect(insert.startsWith(PREFIX)).toBe(true);
      // wrangler の代わりに printf へ渡し、bash が受け取った引数そのものを見る（何も実行しない・外に出ない）
      const { stdout } = await run("bash", ["-c", `printf '%s' ${insert.slice(PREFIX.length)}`], { timeout: TIMEOUT_MS });
      expect(stdout).toMatch(/'pbkdf2-sha256\$100000\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+'/);
      expect(stdout).toContain("INSERT INTO accounts (id, email, password_hash, role, store_id) VALUES (");
      expect(stdout).toContain("'admin@example.com'");
    },
    TIMEOUT_MS,
  );

  it(
    "今いる運営を確かめる文を先頭に出し、番号を指せばその運営を取り返す文を出す",
    async () => {
      const commands = sqlsOf(await print("seed-admin.mjs", ["--email", "admin@example.com", "--password", PASSWORD, "--account-id", "admin-acc-1"]));
      expect(commands[0]).toBe(LIST_ADMINS);
      expect(commands.some((c) => c.includes("UPDATE accounts SET email = 'admin@example.com' WHERE id = 'admin-acc-1'"))).toBe(true);
      expect(commands.some((c) => c.includes("DELETE FROM sessions WHERE account_id = 'admin-acc-1'"))).toBe(true);
    },
    TIMEOUT_MS,
  );
});
