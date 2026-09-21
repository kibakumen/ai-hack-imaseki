// 運営のアカウントを投入する（要件14の基準 14.8: 画面からは作れない）。
// 判断は lib/usecases/seedAdmin.ts が持ち、このスクリプトは D1 の口と入力を渡すだけ
// （パスワードの保存の形をここへ書き写さない）。
//
// 使い方:
//   node web/scripts/seed-admin.mjs --email admin@example.com --password '<16字以上>'
//       → 手元の D1（wrangler の local state）に入れる。先に migrations を当てておくこと:
//         pnpm --dir web exec wrangler d1 migrations apply ai-hack-v2 --local
//   node web/scripts/seed-admin.mjs --email … --password … --print
//       → 本番（--remote）用に、そのまま貼れる wrangler のコマンドを出す（ここでは実行しない）。
//         本番の D1 を、確かめの無いスクリプトから黙って書き換えないため。

import path from "node:path";
import { register } from "node:module";
import { fileURLToPath } from "node:url";

register(new URL("./ts-resolve.mjs", import.meta.url));

const WEB = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATABASE = "ai-hack-v2";

const parseArgs = (argv) => {
  const args = { print: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--print") args.print = true;
    else if (argv[i] === "--email") args.email = argv[++i];
    else if (argv[i] === "--password") args.password = argv[++i];
  }
  return args;
};

/** SQL の文字列の値を1つの引用の中へ入れる（引用符は2つにして閉じない）。--print のときだけ使う。 */
const literal = (value) => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
};

/** ?1 ?2 … を値で埋めた1つの文にする（wrangler d1 execute は束縛の値を取らないため）。 */
const inlined = (sql, args) => sql.replace(/\?(\d+)/g, (_, n) => literal(args[Number(n) - 1])).replace(/\s+/g, " ").trim();

/** --print のときの D1 の代わり。書き込みの文を集め、読み取りは「まだ無い」を返す。 */
const collectingDb = (statements) => ({
  prepare: (sql) => ({
    bind: (...args) => ({
      first: async () => null,
      run: async () => {
        statements.push(inlined(sql, args));
        return { success: true };
      },
      all: async () => ({ results: [] }),
    }),
  }),
  batch: async (stmts) => stmts,
});

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.email || !args.password) {
    console.error("使い方: node web/scripts/seed-admin.mjs --email <メールアドレス> --password <パスワード> [--print]");
    process.exitCode = 1;
    return;
  }

  const [{ seedAdmin }, { createHasher, createRng }] = await Promise.all([
    import("../lib/usecases/seedAdmin.ts"),
    import("../lib/adapters/webcrypto.ts"),
  ]);
  const base = { rng: createRng(), hasher: createHasher(), clock: { now: () => new Date(), after: () => Promise.resolve() } };

  if (args.print) {
    const statements = [];
    await seedAdmin({ ...base, db: collectingDb(statements) }, { email: args.email, password: args.password });
    console.log("# 本番の D1 へ入れるには、次を実行してください（同じメールアドレスが既に在ると UNIQUE で落ちます）");
    for (const sql of statements) {
      console.log(`pnpm --dir web exec wrangler d1 execute ${DATABASE} --remote --command ${JSON.stringify(sql)}`);
    }
    return;
  }

  const { getPlatformProxy } = await import("wrangler");
  // 手元の D1 の実体の置き場は web/.wrangler/state/v3（`wrangler d1 migrations apply --local` が
  // 使う場所）。どこから走らせても同じ D1 を見るように、相対でなく web/ から組み立てて渡す。
  const proxy = await getPlatformProxy({
    configPath: path.join(WEB, "wrangler.jsonc"),
    persist: { path: path.join(WEB, ".wrangler", "state", "v3") },
  });
  try {
    const result = await seedAdmin({ ...base, db: proxy.env.DB }, { email: args.email, password: args.password });
    console.log(result.created ? `運営のアカウントを作りました: ${args.email}` : `運営のアカウントのパスワードを入れ替えました: ${args.email}`);
  } finally {
    await proxy.dispose();
  }
};

await main();
