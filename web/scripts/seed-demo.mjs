// デモ用の種データを投入する（審査で本番の D1 が空のままだと1件も出ない対策）。
// 判断は lib/usecases・lib/repo の実物が持つ。このスクリプトは D1 の口と入力を渡すだけ
// （パスワードの保存の形をここへ書き写さない・seed-admin.mjs と同じ作り）。
//
// 入れるもの: 運営のアカウント1つ／承認済みの店6軒（渋谷駅の徒歩圏）／各店の公開中のオファー1つ
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
//
// 再実行しても安全（同じメールアドレスの店は作り直さず、既にあるクーポン・公開中のオファーは
// 二重に作らない——repo 側の一意性の判断をそのまま使う）。

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
    else if (argv[i] === "--admin-email") args.adminEmail = argv[++i];
    else if (argv[i] === "--admin-password") args.adminPassword = argv[++i];
    else if (argv[i] === "--store-password") args.storePassword = argv[++i];
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

/**
 * --print のときの D1 の代わり。書き込みの文を集め、読み取りは「まだ無い」を返す
 * （本番はどのテーブルも空のまま・実測済みなので、先回りの読み取りは常に「無い」でよい）。
 * `run` は `meta.changes` を1で返す——`insertOfferIfNone` 等が変わった行数を見て分岐するため。
 */
const collectingDb = (statements) => ({
  prepare: (sql) => ({
    bind: (...args) => ({
      first: async () => null,
      run: async () => {
        statements.push(inlined(sql, args));
        return { success: true, meta: { changes: 1 } };
      },
      all: async () => ({ results: [] }),
    }),
  }),
  batch: async (stmts) => stmts,
});

// ---------- 渋谷駅（35.6580, 139.7016）の徒歩圏に散らした店6軒 ----------
// 座標は渋谷駅からの直線距離90〜1180m（座標は AI判断で計算・実在の街区に重ねた住所は目安表記）。
// url は全部 null（架空の店に実在店のサイトを結びつけない）。

const STORES = [
  {
    email: "demo-store-1@example.com",
    name: "渋谷 炉ばた 灯火",
    address: "東京都渋谷区渋谷2-1-1",
    lat: 35.658796,
    lng: 139.701773,
    genres: ["焼き鳥・串", "居酒屋"],
    menus: ["塩焼き5本盛り", "つくね", "だし巻き卵", "生ビール"],
    budgetMin: 2000,
    budgetMax: 4000,
    offer: { capacity: 3, partyMax: 4 },
    coupons: [
      { name: "生ビール1杯無料", note: "来店時に1組1杯まで" },
      { name: "お通し無料", note: "" },
    ],
  },
  {
    email: "demo-store-2@example.com",
    name: "Trattoria Sette",
    address: "東京都渋谷区渋谷3-6-2",
    lat: 35.657501,
    lng: 139.705084,
    genres: ["イタリアン・洋食"],
    menus: ["マルゲリータ", "生ハムとブッラータ", "アマトリチャーナ"],
    budgetMin: 3000,
    budgetMax: 6000,
    offer: { capacity: 5, partyMax: 2 },
    coupons: [
      { name: "ワンドリンク無料", note: "" },
      { name: "前菜プレート無料", note: "2名様まで" },
      { name: "デザート無料", note: "" },
    ],
  },
  {
    email: "demo-store-3@example.com",
    name: "焼肉ホルモン 桜丘亭",
    address: "東京都渋谷区桜丘町4-3",
    lat: 35.653357,
    lng: 139.6995,
    genres: ["焼肉"],
    menus: ["上カルビ", "特選ホルモン", "冷麺"],
    budgetMin: 4000,
    budgetMax: 8000,
    offer: { capacity: 2, partyMax: 6 },
    coupons: [{ name: "上カルビ1皿無料", note: "3名様以上のご利用時" }],
  },
  {
    email: "demo-store-4@example.com",
    name: "らーめん 代々木家",
    address: "東京都渋谷区代々木2-3-1",
    lat: 35.656783,
    lng: 139.693107,
    genres: ["ラーメン"],
    menus: ["醤油ラーメン", "味噌ラーメン", "替え玉"],
    budgetMin: 800,
    budgetMax: 1500,
    offer: { capacity: 8, partyMax: 2 },
    coupons: [{ name: "替え玉無料", note: "1名様1回まで" }],
  },
  {
    email: "demo-store-5@example.com",
    name: "ソウル横丁 渋谷東店",
    address: "東京都渋谷区東3-15-5",
    lat: 35.664744,
    lng: 139.708565,
    genres: ["韓国料理", "カフェ・バー"],
    menus: ["チーズハットグ", "サムギョプサル", "マッコリ"],
    budgetMin: 2500,
    budgetMax: 5000,
    offer: { capacity: 4, partyMax: 4 },
    coupons: [
      { name: "チーズハットグ無料", note: "" },
      { name: "マッコリ1杯無料", note: "来店時に1組1杯まで" },
    ],
  },
  {
    email: "demo-store-6@example.com",
    name: "鮨処 神南",
    address: "東京都渋谷区神南1-20-8",
    lat: 35.66612,
    lng: 139.693214,
    genres: ["寿司・海鮮"],
    menus: ["おまかせ握り10貫", "海鮮丼", "茶碗蒸し"],
    budgetMin: 5000,
    budgetMax: 10000,
    offer: { capacity: 1, partyMax: 2 },
    coupons: [
      { name: "お通し無料", note: "" },
      { name: "日本酒1杯無料", note: "" },
      { name: "デザート握り無料", note: "" },
    ],
  },
];

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 「今」から見た、当日23:00（日本時間）を ISO 8601 で返す（domain/until.ts と同じ日本時間の扱い）。 */
const closingTimeIso = (now) => {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const closingJst = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), 23, 0, 0, 0);
  return new Date(closingJst - JST_OFFSET_MS).toISOString();
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.adminEmail || !args.adminPassword || !args.storePassword) {
    console.error(
      "使い方: node web/scripts/seed-demo.mjs --admin-email <メールアドレス> --admin-password <パスワード> --store-password <パスワード> [--print]",
    );
    process.exitCode = 1;
    return;
  }

  const [{ seedAdmin }, { createHasher, createRng }, { hashPassword }, { ID_BYTES }, { tokenFromBytes }] = await Promise.all([
    import("../lib/usecases/seedAdmin.ts"),
    import("../lib/adapters/webcrypto.ts"),
    import("../lib/usecases/credentials.ts"),
    import("../lib/schemas/limits.ts"),
    import("../lib/domain/token.ts"),
  ]);
  const { findAccountByEmail, insertAccount } = await import("../lib/repo/accounts.ts");
  const { insertStoreStatement, updateStoreProfile } = await import("../lib/repo/stores.ts");
  const { approveStoreStatement } = await import("../lib/repo/adminStores.ts");
  const { listCoupons, insertCoupon } = await import("../lib/repo/coupons.ts");
  const { insertOfferIfNone } = await import("../lib/repo/offers.ts");

  const base = { rng: createRng(), hasher: createHasher(), clock: { now: () => new Date(), after: () => Promise.resolve() } };

  /** 店1軒ぶん（店・アカウント・情報・承認・クーポン・オファー）を入れる。既にあれば作り直さない。 */
  const seedStore = async (deps, spec, storePasswordHash) => {
    const existingAccount = await findAccountByEmail(deps.db, spec.email);
    let storeId;
    let created;
    if (existingAccount) {
      if (existingAccount.role !== "store" || !existingAccount.storeId) {
        throw new Error(`${spec.email} は店のアカウントに使われていません`);
      }
      storeId = existingAccount.storeId;
      created = false;
    } else {
      storeId = tokenFromBytes(deps.rng.bytes(ID_BYTES));
      const accountId = tokenFromBytes(deps.rng.bytes(ID_BYTES));
      await insertStoreStatement(deps.db, { id: storeId, name: spec.name, createdAtIso: deps.clock.now().toISOString() }).run();
      await insertAccount(deps.db, { id: accountId, email: spec.email, role: "store", storeId, passwordHash: storePasswordHash });
      created = true;
    }

    // 情報と承認は毎回当て直す（審査前の再実行で状態が変わっていないことを確かめられるように）。
    await updateStoreProfile(deps.db, storeId, {
      name: spec.name,
      address: spec.address,
      url: null,
      genres: spec.genres,
      menus: spec.menus,
      budgetMin: spec.budgetMin,
      budgetMax: spec.budgetMax,
      lat: spec.lat,
      lng: spec.lng,
    });
    await approveStoreStatement(deps.db, storeId).run();

    // ⚠️ 挿した直後に読み直さない——--print の集める役の db は読み取りを常に「無い」で返す
    // （本番はどの表も空という前回りの前提）ので、挿した値をその場で使う。
    let coupons = await listCoupons(deps.db, storeId);
    if (coupons.length === 0) {
      const inserted = [];
      for (const coupon of spec.coupons) {
        const id = tokenFromBytes(deps.rng.bytes(ID_BYTES));
        const createdAtIso = deps.clock.now().toISOString();
        await insertCoupon(deps.db, { id, storeId, name: coupon.name, note: coupon.note ?? "", createdAtIso });
        inserted.push({ id, name: coupon.name, note: coupon.note ?? "", createdAt: createdAtIso });
      }
      coupons = inserted;
    }

    const offerId = tokenFromBytes(deps.rng.bytes(ID_BYTES));
    const now = deps.clock.now();
    const offerInserted = await insertOfferIfNone(deps.db, {
      id: offerId,
      storeId,
      capacity: spec.offer.capacity,
      partyMax: spec.offer.partyMax,
      publishedAtIso: now.toISOString(),
      untilAtIso: closingTimeIso(now),
      couponIds: coupons.map((c) => c.id),
    });

    return { storeId, created, couponCount: coupons.length, offerInserted };
  };

  if (args.print) {
    const statements = [];
    const deps = { ...base, db: collectingDb(statements) };
    await seedAdmin(deps, { email: args.adminEmail, password: args.adminPassword });
    const storePasswordHash = await hashPassword(deps, args.storePassword);
    for (const spec of STORES) {
      await seedStore(deps, spec, storePasswordHash);
    }
    console.log("# 本番の D1 へ入れるには、次を順番に実行してください（既に何か入っていると UNIQUE で落ちます）");
    for (const sql of statements) {
      console.log(`pnpm --dir web exec wrangler d1 execute ${DATABASE} --remote --command ${JSON.stringify(sql)}`);
    }
    return;
  }

  const { getPlatformProxy } = await import("wrangler");
  const proxy = await getPlatformProxy({
    configPath: path.join(WEB, "wrangler.jsonc"),
    persist: { path: path.join(WEB, ".wrangler", "state", "v3") },
  });
  try {
    const deps = { ...base, db: proxy.env.DB };
    const adminResult = await seedAdmin(deps, { email: args.adminEmail, password: args.adminPassword });
    console.log(
      adminResult.created ? `運営のアカウントを作りました: ${args.adminEmail}` : `運営のアカウントのパスワードを入れ替えました: ${args.adminEmail}`,
    );

    const storePasswordHash = await hashPassword(deps, args.storePassword);
    for (const spec of STORES) {
      const result = await seedStore(deps, spec, storePasswordHash);
      const offerLine = result.offerInserted ? `オファー公開（${spec.offer.capacity}組/${spec.offer.partyMax}名）` : "オファーは既に公開中のためスキップ";
      console.log(
        `${result.created ? "店を登録しました" : "既存の店を更新しました"}: ${spec.name} (${spec.email}) / 承認済み / クーポン${result.couponCount}枚 / ${offerLine}`,
      );
    }
  } finally {
    await proxy.dispose();
  }
};

await main();
