// ホーム画面のアイコン（public/icon-*.png・public/apple-touch-icon.png）を作り直すスクリプト
// （2026-09-25 監査の指摘 客-04 の案C。app/manifest.ts と app/layout.tsx の icons が指す）。
//
// 画像の道具を増やさないため、PNG を自前で組む（橙の地に白い椅子。形は public/icon.svg と同じ）。
// 使い方: node web/scripts/make-app-icons.mjs  （出力を commit する。ビルドでは走らせない）

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

/** 地（明るい配色の --color-accent）と図（白） */
const BACKGROUND = [0xea, 0x58, 0x0c];
const FOREGROUND = [0xff, 0xff, 0xff];

/** 正面から見た椅子（1辺を 1 とした座標の四角の並び。public/icon.svg の rect と同じ値） */
const SHAPES = [
  { x: 0.3, y: 0.16, w: 0.4, h: 0.1 }, // 背もたれの上の横木
  { x: 0.3, y: 0.16, w: 0.09, h: 0.36 }, // 背もたれの左の柱
  { x: 0.61, y: 0.16, w: 0.09, h: 0.36 }, // 背もたれの右の柱
  { x: 0.24, y: 0.5, w: 0.52, h: 0.11 }, // 座面
  { x: 0.3, y: 0.61, w: 0.09, h: 0.24 }, // 左の脚
  { x: 0.61, y: 0.61, w: 0.09, h: 0.24 }, // 右の脚
];

const inShape = (u, v) => SHAPES.some((s) => u >= s.x && u < s.x + s.w && v >= s.y && v < s.y + s.h);

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};

/** 1辺 size の正方形の PNG（RGB・8bit） */
const png = (size) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Array.from({ length: size }, (_, y) => {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x += 1) row.set(inShape((x + 0.5) / size, (y + 0.5) / size) ? FOREGROUND : BACKGROUND, 1 + x * 3);
    return row;
  });
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
};

for (const [name, size] of [
  ["apple-touch-icon.png", 180],
  ["icon-192.png", 192],
  ["icon-512.png", 512],
]) {
  fs.writeFileSync(path.join(PUBLIC, name), png(size));
}
