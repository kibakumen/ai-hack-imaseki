// デモ用の種データを投入する（審査で本番の D1 が空のままだと1件も出ない対策）。
// 判断は lib/usecases/seedDemo.ts が持つ。このスクリプトは D1 の口と入力（店の配列）を渡すだけ
// （2026-09-25 安全-01 のレビューで判断を移した。ここに置いていた店の投入は型の検査を通らず、repo の関数の名前が
// 変わったとき〔設計-14〕に古い名前を呼んだまま落ちていた）。
//
// 入れるもの: 運営のアカウント1つ／承認済みの店6軒（会場・御茶ノ水ソラシティの徒歩圏）／各店の公開中のオファー1つ
// （終了は当日23:00 JST）／各店のクーポン1〜3枚。
//
// 使い方:
//   node web/scripts/seed-demo.mjs --admin-email admin@example.com --admin-password '<16字以上>' \
//       --store-password '<16字以上>'
//       → 手元の D1（wrangler の local state）に入れる。先に migrations を当てておくこと:
//         pnpm --dir web exec wrangler d1 migrations apply ai-hack-v2 --local
//   node web/scripts/seed-demo.mjs --admin-email … --admin-password … --store-password … --print
//       → 本番（--remote）用に、そのまま貼れる wrangler のコマンドを出す（ここでは実行しない）。
//         本番の D1 を、確かめの無いスクリプトから黙って書き換えないため。
//         ⚠️ --print は本番の D1 を読めないので、店は「まだ無い」前提の文になる。デモ店が既に在る本番には流さない
//         （運営の取り返しは seed-admin.mjs、既に在るデモ店の鍵の入れ替えは下の --rotate-stores・README 5.3）。
//   node web/scripts/seed-demo.mjs --rotate-stores --store-password '<新しい共通のパスワード>' [--print]
//       → デモ店（demo-store-*）のパスワードだけを入れ替え、そのセッションを全部切る（店・オファー・運営には触れない）。
//         --print を付けると本番へ貼る2つのコマンドを出す（単一引用。保存の値の `$` を bash に展開させない・2026-09-26 のレビュー）。
//
// 運営の扱いは seed-admin.mjs と同じ（安全-01）:
//   - 書く前に、今いる運営の一覧を出す。同じメールアドレスが在ればパスワードを入れ替え、セッションを全部切る
//   - 別のメールアドレスの運営がいれば、黙って2人目を作らずに止まる（店にも何も書かない）。メールアドレスを
//     変えられた運営を取り返すなら `--admin-account-id <一覧の番号>`、本当に2人目を足すときだけ `--add`
//
// 再実行しても安全（同じメールアドレスの店は作り直さず、既にあるクーポン・公開中のオファーは二重に作らない）。
// 既にある店のアカウントは、パスワードを --store-password に入れ替え、そのセッションを全部切る。止められた店は
// 承認済みへ戻す（乗っ取られて締め出されたデモ店を、作り直しで取り返せるように）。

import path from "node:path";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { collectingDb, LIST_ADMINS_SQL, remoteCommand } from "./print-sql.mjs";

register(new URL("./ts-resolve.mjs", import.meta.url));

const WEB = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const parseArgs = (argv) => {
  const args = { print: false, add: false, rotateStores: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--print") args.print = true;
    else if (argv[i] === "--rotate-stores") args.rotateStores = true;
    else if (argv[i] === "--add") args.add = true;
    else if (argv[i] === "--admin-email") args.adminEmail = argv[++i];
    else if (argv[i] === "--admin-password") args.adminPassword = argv[++i];
    else if (argv[i] === "--admin-account-id") args.adminAccountId = argv[++i];
    else if (argv[i] === "--store-password") args.storePassword = argv[++i];
  }
  return args;
};

// ---------- 会場（御茶ノ水ソラシティ・35.6984924, 139.7668622）の徒歩圏に散らした店6軒 ----------
// 座標は会場からの直線距離144〜785m・全店 800m 圏内（座標は AI判断で計算・実在の街区に重ねた住所は目安表記）。
// url は全部 null（架空の店に実在店のサイトを結びつけない）。ジャンルは lib/domain/genres.ts の値のみ使う。

const STORES = [
  {
    email: "demo-store-1@example.com",
    name: "喫茶 駿河台文庫",
    address: "東京都千代田区神田駿河台4-3",
    lat: 35.699211,
    lng: 139.76819,
    genres: ["カフェ・バー"],
    menus: ["ブレンドコーヒー", "ナポリタン", "自家製プリン"],
    budgetMin: 700,
    budgetMax: 1300,
    offer: { capacity: 6, partyMax: 2 },
    coupons: [{ name: "ブレンドコーヒー1杯無料", note: "" }],
  },
  {
    email: "demo-store-2@example.com",
    name: "らーめん 駿台亭",
    address: "東京都千代田区神田駿河台2-5",
    lat: 35.700828,
    lng: 139.766199,
    genres: ["ラーメン"],
    menus: ["醤油ラーメン", "チャーシュー麺", "餃子"],
    budgetMin: 800,
    budgetMax: 1400,
    offer: { capacity: 8, partyMax: 2 },
    coupons: [{ name: "餃子1皿無料", note: "1名様1回まで" }],
  },
  {
    email: "demo-store-3@example.com",
    name: "手打ちそば 小川町庵",
    address: "東京都千代田区神田小川町3-8",
    lat: 35.698223,
    lng: 139.761995,
    genres: ["そば・うどん"],
    menus: ["天ざる蕎麦", "かけそば", "天丼セット"],
    budgetMin: 900,
    budgetMax: 1800,
    offer: { capacity: 4, partyMax: 4 },
    coupons: [
      { name: "天丼セット無料", note: "" },
      { name: "そば湯サービス", note: "" },
    ],
  },
  {
    email: "demo-store-4@example.com",
    name: "欧風カレー 神保町亭",
    address: "東京都千代田区神田神保町1-15",
    lat: 35.694719,
    lng: 139.762106,
    genres: ["カレー・エスニック"],
    menus: ["ビーフカレー", "カツカレー", "キーマカレー（ナン付き）"],
    budgetMin: 1200,
    budgetMax: 2200,
    offer: { capacity: 3, partyMax: 4 },
    coupons: [
      { name: "ナン1枚無料", note: "" },
      { name: "ラッシー1杯無料", note: "来店時に1組1杯まで" },
    ],
  },
  {
    email: "demo-store-5@example.com",
    name: "中華飯店 錦町楼",
    address: "東京都千代田区神田錦町3-4",
    lat: 35.694001,
    lng: 139.761331,
    genres: ["中華"],
    menus: ["麻婆豆腐", "餃子", "炒飯"],
    budgetMin: 1000,
    budgetMax: 2000,
    offer: { capacity: 5, partyMax: 6 },
    coupons: [{ name: "餃子1皿無料", note: "" }],
  },
  {
    email: "demo-store-6@example.com",
    name: "とんかつ 猿楽亭",
    address: "東京都千代田区神田猿楽町2-7",
    lat: 35.696696,
    lng: 139.758455,
    genres: ["和食"],
    menus: ["ロースかつ定食", "ヒレかつ定食", "海老フライ"],
    budgetMin: 1300,
    budgetMax: 2400,
    offer: { capacity: 2, partyMax: 2 },
    coupons: [
      { name: "お新香無料", note: "" },
      { name: "味噌汁おかわり無料", note: "" },
      { name: "デザート無料", note: "" },
    ],
  },
];

const USAGE = [
  "使い方: node web/scripts/seed-demo.mjs --admin-email <メールアドレス> --admin-password <パスワード> --store-password <パスワード> [--admin-account-id <運営の番号>] [--add] [--print]",
  "        node web/scripts/seed-demo.mjs --rotate-stores --store-password <パスワード> [--print]",
].join("\n");

const adminsLine = (admins) => `書く前にいた運営: ${admins.length === 0 ? "なし" : admins.map((a) => `${a.email} [${a.id}]`).join(", ")}`;

const printCommands = async (seedDemo, base, input, adminAccountId) => {
  const statements = [];
  await seedDemo({ ...base, db: collectingDb(statements, adminAccountId) }, input);
  console.log("# 1. まず今いる運営を確かめてください（読むだけ）。メールアドレスが変えられていたら、その番号を --admin-account-id に渡して出し直す");
  console.log(remoteCommand(LIST_ADMINS_SQL));
  console.log(
    adminAccountId
      ? `# 2. 番号 ${adminAccountId} の運営のメールアドレスとパスワードを入れ替え、その運営のセッションを全部切り、店を入れます`
      : "# 2. 運営と店を新しく作ります（デモ店が既に在る D1 には流さない。店だけが二重にできる）",
  );
  for (const sql of statements) console.log(remoteCommand(sql));
};

const reportLocal = (result) => {
  console.log(adminsLine(result.admin.adminsBefore));
  console.log(
    result.admin.created
      ? "運営のアカウントを作りました"
      : `運営のアカウント [${result.admin.accountId}] のパスワードを入れ替え、そのセッションを全部切りました`,
  );
  for (const store of result.stores) {
    const spec = STORES.find((s) => s.email === store.email);
    const offerLine = store.offerInserted ? `オファー公開（${spec.offer.capacity}組/${spec.offer.partyMax}名）` : "オファーは既に公開中のためスキップ";
    const accountLine = store.created ? "店を登録しました" : "既存の店を更新し、パスワードを入れ替えてセッションを全部切りました";
    console.log(`${accountLine}: ${spec.name} (${store.email}) / 承認済み / クーポン${store.couponCount}枚 / ${offerLine}`);
  }
};

/** 手元の D1（wrangler の local state）を開いて渡し、終わったら閉じる。 */
const withLocalDb = async (work) => {
  const { getPlatformProxy } = await import("wrangler");
  const proxy = await getPlatformProxy({
    configPath: path.join(WEB, "wrangler.jsonc"),
    persist: { path: path.join(WEB, ".wrangler", "state", "v3") },
  });
  try {
    await work(proxy.env.DB);
  } finally {
    await proxy.dispose();
  }
};

/** デモ店のパスワードだけを入れ替える（--rotate-stores）。 */
const rotateStores = async (args, base) => {
  const { rotateDemoStorePasswords } = await import("../lib/usecases/seedDemo.ts");
  const input = { storePassword: args.storePassword, emails: STORES.map((s) => s.email) };
  if (args.print) {
    const statements = [];
    await rotateDemoStorePasswords({ ...base, db: collectingDb(statements) }, input);
    console.log("# デモ店のパスワードを入れ替え、そのセッションを全部切ります（店・オファー・運営には触れません）。この順に流してください");
    for (const sql of statements) console.log(remoteCommand(sql));
    return;
  }
  await withLocalDb(async (db) => {
    await rotateDemoStorePasswords({ ...base, db }, input);
    console.log(`デモ店${STORES.length}軒のパスワードを入れ替え、そのセッションを全部切りました（手元の D1）`);
  });
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.rotateStores) {
    if (!args.storePassword) {
      console.error(USAGE);
      process.exitCode = 1;
      return;
    }
    const { createHasher, createRng } = await import("../lib/adapters/webcrypto.ts");
    await rotateStores(args, { rng: createRng(), hasher: createHasher(), clock: { now: () => new Date(), after: () => Promise.resolve() } });
    return;
  }
  if (!args.adminEmail || !args.adminPassword || !args.storePassword) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  const input = {
    admin: { email: args.adminEmail, password: args.adminPassword, accountId: args.adminAccountId, allowAnotherAdmin: args.add },
    storePassword: args.storePassword,
    stores: STORES,
  };

  const [{ seedDemo }, { OtherAdminsExistError }, { createHasher, createRng }] = await Promise.all([
    import("../lib/usecases/seedDemo.ts"),
    import("../lib/usecases/seedAdmin.ts"),
    import("../lib/adapters/webcrypto.ts"),
  ]);
  const base = { rng: createRng(), hasher: createHasher(), clock: { now: () => new Date(), after: () => Promise.resolve() } };

  if (args.print) {
    await printCommands(seedDemo, base, input, args.adminAccountId);
    return;
  }

  await withLocalDb(async (db) => {
    try {
      reportLocal(await seedDemo({ ...base, db }, input));
    } catch (error) {
      if (!(error instanceof OtherAdminsExistError)) throw error;
      console.error(`${error.message}。何も書いていません。`);
      console.error("メールアドレスを変えられた運営を取り返すなら --admin-account-id <番号>、2人目を足すなら --add を付けてください。");
      process.exitCode = 1;
    }
  });
};

await main();
