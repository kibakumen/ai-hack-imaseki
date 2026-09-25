// 全画面に共通する見た目の決めごと（2026-09-25 監査の指摘 横断-04・横断-06・横断-10・横断-13）。
// jsdom は CSS を計算しないので、宣言の側を読んで確かめる（道具は tests/_css.ts）。
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allRules, contrast, declOf, fillColors, palette, parseCss, WEB } from "./_css";

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

// ---------- 明るさの比（横断-04 の案A） ----------
// 塗りのボタンと橙の文字は濃い橙（--color-accent-strong）で描き、明るい橙（--color-accent）は飾り（縁・影・
// 文字を載せない帯）にだけ使う。明るい設定の白い文字と #ea580c は 3.56:1 で、WCAG 2.1 AA（1.4.3）の 4.5:1 に届かなかった。

/** 文字と地の組（明暗の両方で 4.5:1 以上）。左が文字、右が地。 */
const TEXT_PAIRS: Array<[string, string, string]> = [
  ["--color-accent-text", "--color-accent-strong", "塗りのボタンの文字"],
  ["--color-accent-strong", "--color-background", "橙の文字（リンク・現在地を使う・経路）"],
  ["--color-accent-strong", "--color-surface", "面の上の橙の文字"],
  ["--color-accent-strong", "--color-accent-soft", "選んだ札の橙の文字"],
  ["--color-text", "--color-background", "本文"],
  ["--color-text", "--color-surface", "面の上の本文"],
  ["--color-text-muted", "--color-background", "淡い文（placeholder・注）"],
  ["--color-text-muted", "--color-surface", "面の上の淡い文"],
  ["--color-danger", "--color-background", "断りの文"],
  ["--color-highlight-text", "--color-highlight", "紹介文・待つ間の文"],
  ["--color-success", "--color-background", "済んだ知らせ"],
];

/** 明るい橙を塗ってよい、文字を載せない飾り（増やすときは、そこに文字が載らないことを確かめてから足す）。 */
const DECORATIVE_ACCENT_FILLS = new Set<string>([
  ".offer-card::before", // 客の結果のカードの上の縁の帯
  ".store-card--accent::before", // 店の強調カードの上の縁の帯
  ".store-chart__key--received::before", // 今日の動きの凡例の色の印
  ".store-progress__bar", // 受け取られた数の棒（数は棒の外に書く）
  ".tile::before", // 運営の数字の札の上の帯
  ".barFill", // 運営の数字の棒
]);

const hasBareAccent = (value: string): boolean => {
  // color-mix(…) の中は薄めた地（文字は濃い色で載る）なので除き、残りに素の --color-accent が在るかを見る
  let out = "";
  let depth = 0;
  for (let k = 0; k < value.length; k += 1) {
    if (value.startsWith("color-mix(", k) && depth === 0) {
      depth = 1;
      k += "color-mix(".length - 1;
      continue;
    }
    if (depth > 0) {
      if (value[k] === "(") depth += 1;
      if (value[k] === ")") depth -= 1;
      continue;
    }
    out += value[k];
  }
  return /var\(\s*--color-accent\s*\)/.test(out);
};

describe("明るさの比（横断-04）", () => {
  for (const theme of ["light", "dark"] as const) {
    it(`${theme === "light" ? "明るい" : "暗い"}配色で、文字と地の組がどれも 4.5:1 以上`, () => {
      const colors = palette(theme);
      for (const [fg, bg, what] of TEXT_PAIRS) {
        expect(colors[fg], `${fg} が定義されていない`).toBeDefined();
        expect(colors[bg], `${bg} が定義されていない`).toBeDefined();
        expect(contrast(colors[fg], colors[bg]), `${what}（${fg} / ${bg}）`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  it("文字の色に明るい橙（--color-accent）を使わない（濃い橙 --color-accent-strong を使う）", () => {
    const offenders = allRules().flatMap((rule) =>
      rule.decls.filter((d) => d.prop === "color" && /var\(\s*--color-accent\s*[,)]/.test(d.value)).map(() => `${path.basename(rule.file)}: ${rule.selector}`),
    );
    expect(offenders).toEqual([]);
  });

  it("文字の色を透かさない（color-mix で薄めた文字は地によって読めなくなる。淡い文は --color-text-muted）", () => {
    const offenders = allRules().flatMap((rule) =>
      rule.decls
        .filter((d) => (d.prop === "color" || d.prop === "-webkit-text-fill-color") && /color-mix\(|transparent|currentColor/.test(d.value.replace(/var\((--[-\w]+),[^)]*\)\)?/g, "var($1)")))
        .map((d) => `${path.basename(rule.file)}: ${rule.selector} { ${d.prop}: ${d.value} }`),
    );
    expect(offenders).toEqual([]);
  });

  it("placeholder は --color-text-muted のまま（薄めない）", () => {
    const placeholders = allRules().filter((rule) => rule.selector.includes("::placeholder"));
    expect(placeholders.length).toBeGreaterThan(0);
    for (const rule of placeholders) expect(declOf(rule, "color"), rule.selector).toBe("var(--color-text-muted)");
  });

  it("地の色の文字（--color-accent-text）を載せる塗りは、明暗の両方で 4.5:1 以上（グラデーションは止まりの色の全部）", () => {
    const offenders: string[] = [];
    for (const theme of ["light", "dark"] as const) {
      const colors = palette(theme);
      for (const rule of allRules()) {
        if (declOf(rule, "color") !== "var(--color-accent-text)") continue;
        const fill = declOf(rule, "background") ?? declOf(rule, "background-color");
        if (fill === undefined) continue;
        const stops = fillColors(fill, colors);
        if (stops === null) {
          offenders.push(`${theme}: ${path.basename(rule.file)}: ${rule.selector} の塗りが読めない（${fill}）`);
          continue;
        }
        for (const stop of stops) {
          const ratio = contrast(colors["--color-accent-text"], stop);
          if (ratio < 4.5) offenders.push(`${theme}: ${path.basename(rule.file)}: ${rule.selector}（${stop} は ${ratio.toFixed(2)}:1）`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("明るい橙の塗りは、文字を載せない飾りだけ（ボタン・札・数の丸は濃い橙で塗る）", () => {
    const offenders = allRules()
      .filter((rule) => rule.decls.some((d) => /^background(-color|-image)?$/.test(d.prop) && hasBareAccent(d.value)))
      .map((rule) => rule.selector)
      .filter((selector) => !DECORATIVE_ACCENT_FILLS.has(selector));
    expect(offenders).toEqual([]);
  });
});
