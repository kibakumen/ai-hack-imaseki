// 用語の統一（2026-09-25 監査の指摘 横断-11 の、指摘の中で最初に挙がった案。AI判断で選んだ語は decisions に記録）。
//
// 同じ状態・同じものを、役割や画面ごとに別の言葉で呼んでいた——運営の札と絞り込みは「止められている」、店の帯も
// 「止められている」、客には「停止」、ボタンは本人の指摘で「登録を取り消す」。番号は客の画面で「確保番号」、店の確かめで
// 「コード」。店の情報のタブは「店舗情報」、その見出しは「お店の情報」、案内では「店の情報」。
// 語の正本は lib/domain/texts.ts の TERMS（1つの語に1つの意味）。画面に出る文字（コメントを除く）に、揃える前の
// 言い方が残っていないことを見る。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TERMS } from "../lib/domain/texts";

const WEB = path.resolve(__dirname, "..");

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : walk(p);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [p] : [];
  });

/** 画面に出る文字の在りか: 部品・画面・決まった文の置き場 */
const SOURCES = [...walk(path.join(WEB, "components")), ...walk(path.join(WEB, "app")).filter((f) => !f.includes(`${path.sep}api${path.sep}`)), path.join(WEB, "lib", "domain", "texts.ts")];

/** コメント（// … と /* … *\/ と JSX の {/* … *\/}）を除いた本文 */
const withoutComments = (text: string): string => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

/** 揃える前の言い方（左）と、正本の語（右） */
const RETIRED: Array<[RegExp, string]> = [
  [/止められて/, `店の状態は「${TERMS.storeBanned}」、操作は「${TERMS.storeBan}」`],
  [/運営(?:が|の|により|に)?(?:この)?(?:お店を)?停止/, `運営の操作は「${TERMS.storeBan}」`],
  // 「公開を止める」（オファーの操作）は別のものなので残す。店についての「止める」だけを見る
  [/店を止め|止めるのをやめ|止めたときに|止めた店/, `店については「${TERMS.storeBan}」`],
  [/お店の情報|店の情報/, `「${TERMS.storeProfile}」`],
  [/(?<!セキュリティ|QR)コード/, `客と店の両方で「${TERMS.reservationCode}」`],
];

describe("用語の統一（横断-11）", () => {
  it("正本の語は4つ（登録を取り消す／登録取り消し済み／確保番号／店舗情報）", () => {
    expect(TERMS).toEqual({ storeBan: "登録を取り消す", storeBanned: "登録取り消し済み", reservationCode: "確保番号", storeProfile: "店舗情報" });
  });

  it("画面に出る文字に、揃える前の言い方が残っていない", () => {
    const offenders: string[] = [];
    for (const file of SOURCES) {
      const lines = withoutComments(fs.readFileSync(file, "utf8")).split("\n");
      lines.forEach((line, index) => {
        for (const [pattern, instead] of RETIRED) if (pattern.test(line)) offenders.push(`${path.relative(WEB, file)}:${index + 1}: ${line.trim()} → ${instead}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
