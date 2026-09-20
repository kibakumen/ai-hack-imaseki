// 種データを作る: node scripts/seed.mjs > migrations/0003_v2seed.sql
// 店の鍵は平文で .store-keys.local（git の対象外）に書く。
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";

const sha = (s) => createHash("sha256").update(s).digest("hex");
const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const now = Date.now();

const stores = [
  {
    id: "st-maru", key: "maru-2026", name: "炭火酒場 まる", genre: "居酒屋", price: 3500,
    address: "東京都渋谷区道玄坂1-2-3", url: "https://example.com/maru", lat: 35.6585, lng: 139.699, approved: 1,
    menus: [
      { name: "焼き鳥盛り合わせ", price: 980, allergens: [] },
      { name: "鶏の唐揚げ", price: 680, allergens: ["小麦"] },
      { name: "刺身3種", price: 1280, allergens: [] },
      { name: "エビマヨ", price: 780, allergens: ["えび", "卵"] },
    ],
    offers: [
      { title: "ドリンク1杯無料", party: 2, qty: 3, note: "", start: 15 * 60, end: 23 * 60 },
      { title: "お会計10%オフ", party: 4, qty: 2, note: "食べログ限定 #A-4412", start: 15 * 60, end: 23 * 60 },
      { title: "唐揚げ1皿サービス", party: 6, qty: 1, note: "", start: 15 * 60, end: 23 * 60 },
    ],
  },
  {
    id: "st-fukurai", key: "fukurai-2026", name: "町中華 福来", genre: "中華", price: 1200,
    address: "東京都渋谷区宇田川町5-6", url: "https://example.com/fukurai", lat: 35.66, lng: 139.7008, approved: 1,
    menus: [
      { name: "餃子6個", price: 420, allergens: ["小麦"] },
      { name: "炒飯", price: 780, allergens: ["卵"] },
      { name: "麻婆豆腐", price: 880, allergens: [] },
      { name: "エビチリ", price: 1180, allergens: ["えび"] },
    ],
    offers: [
      { title: "餃子1皿サービス", party: 2, qty: 4, note: "", start: 11 * 60, end: 22 * 60 },
      { title: "ライス大盛無料", party: 4, qty: 2, note: "", start: 11 * 60, end: 22 * 60 },
    ],
  },
  {
    id: "st-soleil", key: "soleil-2026", name: "パスタ食堂 ソレイユ", genre: "イタリアン", price: 2200,
    address: "東京都渋谷区桜丘町8-1", url: "https://example.com/soleil", lat: 35.6575, lng: 139.702, approved: 1,
    menus: [
      { name: "トマトのパスタ", price: 1180, allergens: ["小麦"] },
      { name: "ジェノベーゼ", price: 1280, allergens: ["小麦", "乳"] },
      { name: "ペスカトーレ", price: 1580, allergens: ["小麦", "えび", "かに"] },
      { name: "季節のサラダ", price: 680, allergens: [] },
    ],
    offers: [
      { title: "前菜1品サービス", party: 2, qty: 2, note: "", start: 11 * 60, end: 15 * 60 },
      { title: "食後のドルチェ無料", party: 4, qty: 1, note: "", start: 17 * 60, end: 22 * 60 },
    ],
  },
  {
    id: "st-ichizu", key: "ichizu-2026", name: "ラーメン一途 恵比寿", genre: "ラーメン", price: 1000,
    address: "東京都渋谷区恵比寿西2-1", url: "https://example.com/ichizu", lat: 35.6485, lng: 139.71, approved: 1,
    menus: [
      { name: "醤油ラーメン", price: 900, allergens: ["小麦", "卵"] },
      { name: "つけ麺", price: 1050, allergens: ["小麦", "卵"] },
    ],
    offers: [{ title: "味玉サービス", party: 2, qty: 5, note: "", start: 11 * 60, end: 23 * 60 }],
  },
  {
    id: "st-noix", key: "noix-2026", name: "カフェ ノワ（新規申請）", genre: "カフェ", price: 900,
    address: "東京都渋谷区神南1-9", url: "https://example.com/noix", lat: 35.659, lng: 139.7, approved: 0,
    menus: [
      { name: "本日のケーキ", price: 620, allergens: ["小麦", "卵", "乳"] },
      { name: "季節のフルーツティー", price: 720, allergens: [] },
    ],
    offers: [{ title: "ドリンク100円引き", party: 2, qty: 5, note: "", start: 9 * 60, end: 19 * 60 }],
  },
];

const lines = ["-- 種データ（速成版 v2・自動生成）", "DELETE FROM s_claims;", "DELETE FROM s_requests;", "DELETE FROM s_offers;", "DELETE FROM s_customers;", "DELETE FROM s_stores;"];

stores.forEach((s) => {
  lines.push(
    `INSERT INTO s_stores (id, key_hash, name, genre, price_avg, address, url, lat, lng, menus, approved, created_at) VALUES (${q(s.id)}, ${q(sha(s.key))}, ${q(s.name)}, ${q(s.genre)}, ${s.price}, ${q(s.address)}, ${q(s.url)}, ${s.lat}, ${s.lng}, ${q(JSON.stringify(s.menus))}, ${s.approved}, ${now});`,
  );
  s.offers.forEach((o, i) => {
    lines.push(
      `INSERT INTO s_offers (id, store_id, title, party_size, qty, remaining, coupon_note, start_min, end_min, active, sort_order, created_at) VALUES (${q(`${s.id}-o${i + 1}`)}, ${q(s.id)}, ${q(o.title)}, ${o.party}, ${o.qty}, ${o.qty}, ${q(o.note)}, ${o.start}, ${o.end}, 1, ${i}, ${now});`,
    );
  });
});

writeFileSync(
  new URL("../.store-keys.local", import.meta.url),
  stores.map((s) => `${s.name}\t/store?key=${s.key}`).join("\n") + "\n運営\t/admin?key=unei2026\n",
);

process.stdout.write(lines.join("\n") + "\n");
