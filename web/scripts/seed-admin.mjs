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
//
// 取り返しと入れ替え（2026-09-25 監査の指摘 安全-01）:
//   - 書く前に、今いる運営の一覧を出す。同じメールアドレスが在ればパスワードを入れ替え、そのアカウントの
//     セッションを全部切る（乗っ取った側の画面を残さない）。
//   - 別のメールアドレスの運営がいるときは、黙って2人目を作らずに止める。メールアドレスを変えられた運営を
//     取り返すなら `--account-id <一覧の番号>` で指す（メールアドレスもパスワードも入れ替え、セッションを切る）。
//     本当に2人目を足すときだけ `--add` を付ける。
//   - --print のときは本番の D1 を読めないので、一覧を出す wrangler のコマンドを先頭に出す。先にそれを流して
//     番号を確かめ、取り返すなら `--account-id` を付けて出し直す（同じメールアドレスの入れ替えも番号で指す——
//     番号なしで出す文は「新しく作る」文で、同じメールアドレスが在ると UNIQUE で落ちる）。

import path from "node:path";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { collectingDb, LIST_ADMINS_SQL, remoteCommand } from "./print-sql.mjs";

register(new URL("./ts-resolve.mjs", import.meta.url));

const WEB = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const parseArgs = (argv) => {
  const args = { print: false, add: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--print") args.print = true;
    else if (argv[i] === "--add") args.add = true;
    else if (argv[i] === "--email") args.email = argv[++i];
    else if (argv[i] === "--password") args.password = argv[++i];
    else if (argv[i] === "--account-id") args.accountId = argv[++i];
  }
  return args;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.email || !args.password) {
    console.error("使い方: node web/scripts/seed-admin.mjs --email <メールアドレス> --password <パスワード> [--account-id <運営の番号>] [--add] [--print]");
    process.exitCode = 1;
    return;
  }
  const input = { email: args.email, password: args.password, accountId: args.accountId, allowAnotherAdmin: args.add };

  const [{ seedAdmin, OtherAdminsExistError }, { createHasher, createRng }] = await Promise.all([
    import("../lib/usecases/seedAdmin.ts"),
    import("../lib/adapters/webcrypto.ts"),
  ]);
  const base = { rng: createRng(), hasher: createHasher(), clock: { now: () => new Date(), after: () => Promise.resolve() } };

  if (args.print) {
    const statements = [];
    await seedAdmin({ ...base, db: collectingDb(statements, args.accountId) }, input);
    console.log("# 1. まず今いる運営を確かめてください（読むだけ）。メールアドレスが変えられていたら、その番号を --account-id に渡して出し直す");
    console.log(remoteCommand(LIST_ADMINS_SQL));
    console.log(
      args.accountId
        ? `# 2. 番号 ${args.accountId} の運営のメールアドレスとパスワードを入れ替え、その運営のセッションを全部切ります`
        : "# 2. 新しく運営を作ります（同じメールアドレスが既に在ると UNIQUE で落ちます。入れ替えるなら --account-id で番号を指す）",
    );
    for (const sql of statements) console.log(remoteCommand(sql));
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
    const result = await seedAdmin({ ...base, db: proxy.env.DB }, input);
    console.log(`書く前にいた運営: ${result.adminsBefore.length === 0 ? "なし" : result.adminsBefore.map((a) => `${a.email} [${a.id}]`).join(", ")}`);
    console.log(
      result.created
        ? `運営のアカウントを作りました: ${args.email}`
        : `運営のアカウント [${result.accountId}] を ${args.email} で入れ替え、そのセッションを全部切りました`,
    );
  } catch (error) {
    if (!(error instanceof OtherAdminsExistError)) throw error;
    console.error(`${error.message}。何も書いていません。`);
    console.error("メールアドレスを変えられた運営を取り返すなら --account-id <番号>、2人目を足すなら --add を付けてください。");
    process.exitCode = 1;
  } finally {
    await proxy.dispose();
  }
};

await main();
