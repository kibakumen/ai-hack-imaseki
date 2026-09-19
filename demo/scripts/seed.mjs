// 種データの SQL を作る。店の鍵は乱数で作り、平文は .store-key.local（git 対象外）にだけ書く。
// 使い方: node scripts/seed.mjs > migrations/0002_seed.sql
import crypto from "node:crypto";
import fs from "node:fs";

const key = crypto.randomBytes(18).toString("base64url");
fs.writeFileSync(new URL("../.store-key.local", import.meta.url), `${key}\n`);
const hash = crypto.createHash("sha256").update(key).digest("hex");

const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const store = {
  id: "store-maru", name: "炭火酒場 まる", genre: "居酒屋", avg_price: 3500,
  allergens: ["えび", "かに"], lat: 35.6585, lng: 139.699,
  presets: [{ label: "ドリンク1杯無料" }, { label: "お会計10%オフ" }, { label: "唐揚げ1皿サービス" }],
};
const out = [
  `INSERT INTO stores VALUES (${q(store.id)}, ${q(hash)}, ${q(store.name)}, ${q(store.genre)}, ${store.avg_price}, ${q(JSON.stringify(store.allergens))}, ${store.lat}, ${store.lng}, ${q(JSON.stringify(store.presets))});`,
];

// 決定論の乱数（毎回同じ客が並ぶ）
let s = 20260919;
const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const GENRES = ["居酒屋", "焼肉", "ラーメン", "カフェ", "イタリアン", "和食", "中華", "エスニック"];
const names = ["佐藤", "鈴木", "高橋", "田中", "伊藤", "渡辺", "山本", "中村", "小林", "加藤"];
for (let i = 0; i < 80; i += 1) {
  const r = 1400 * Math.sqrt(rnd());
  const t = 2 * Math.PI * rnd();
  const lat = store.lat + (r * Math.cos(t)) / 111320;
  const lng = store.lng + (r * Math.sin(t)) / (111320 * Math.cos((store.lat * Math.PI) / 180));
  const g1 = GENRES[Math.floor(rnd() * GENRES.length)];
  const genres = rnd() < 0.5 ? [g1, "居酒屋"].filter((v, j, a) => a.indexOf(v) === j) : [g1];
  const budget = [2000, 3000, 4000, 5000, 6000][Math.floor(rnd() * 5)];
  const allergies = rnd() < 0.12 ? ["えび", "かに"] : rnd() < 0.08 ? ["小麦"] : [];
  const id = `seed-${String(i + 1).padStart(3, "0")}`;
  out.push(
    `INSERT INTO customers VALUES (${q(id)}, ${q(`${names[i % names.length]}（登録客${i + 1}）`)}, 'seed', ${lat.toFixed(6)}, ${lng.toFixed(6)}, ${q(JSON.stringify(genres))}, ${budget}, ${q(JSON.stringify(allergies))}, 'seed', 1, 0);`,
  );
}
process.stdout.write(`${out.join("\n")}\n`);
