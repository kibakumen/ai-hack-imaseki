// 全画面に共通する見た目の決めごと（2026-09-25 監査の指摘 横断-04・横断-06・横断-10・横断-13）。
// jsdom は CSS を計算しないので、宣言の側を読んで確かめる（道具は tests/_css.ts）。
import path from "node:path";
import { describe, expect, it } from "vitest";
import { declOf, parseCss, WEB } from "./_css";

const GLOBALS = path.join(WEB, "app", "globals.css");

describe("明暗の手動の選択は、ブラウザ標準の部品にも効く（横断-10）", () => {
  const rules = parseCss(GLOBALS);
  const find = (selector: string, media?: RegExp) => rules.find((r) => r.selector === selector && (media ? r.at.some((a) => media.test(a)) : r.at.length === 0));

  it("「明るい」を選んだら color-scheme は light だけ（端末が暗くても、時刻の欄・select・チェックが明るく描かれる）", () => {
    const light = find(':root[data-theme="light"]');
    expect(light, ':root[data-theme="light"] の規則が無い').toBeDefined();
    expect(declOf(light!, "color-scheme")).toBe("light");
  });

  it("「暗い」を選んだとき・端末が暗いときは color-scheme を dark にする", () => {
    const dark = find(':root[data-theme="dark"]');
    expect(dark && declOf(dark, "color-scheme")).toBe("dark");
    const systemDark = find(':root:not([data-theme="light"])', /prefers-color-scheme:\s*dark/);
    expect(systemDark && declOf(systemDark, "color-scheme")).toBe("dark");
  });
});
