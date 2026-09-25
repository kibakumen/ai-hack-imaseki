// 全画面に共通する見た目の決めごと（2026-09-25 監査の指摘 横断-04・横断-06・横断-10・横断-13）。
// jsdom は CSS を計算しないので、宣言の側を読んで確かめる（道具は tests/_css.ts）。
import path from "node:path";
import { describe, expect, it } from "vitest";
import { allRules, contrast, declOf, fillColors, palette, parseCss, resolveColor, WEB } from "./_css";

const GLOBALS = path.join(WEB, "app", "globals.css");
/** 画面の CSS 全部の規則（ファイルを分けても、セレクタで引けるようにする・設計-16 で CSS を分けた） */
const RULES = allRules();
const STORE_RULES = RULES.filter((r) => r.file.startsWith(path.join(WEB, "app", "store") + path.sep));

describe("明暗の手動の選択は、ブラウザ標準の部品にも効く（横断-10）", () => {
  const rules = RULES;
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

  it("同じ規則で文字の色と地を決めているところは、明暗の両方で 4.5:1 以上（地が読める色の式のときだけ）", () => {
    const offenders: string[] = [];
    for (const theme of ["light", "dark"] as const) {
      const colors = palette(theme);
      for (const rule of allRules()) {
        const color = declOf(rule, "color");
        const fill = declOf(rule, "background") ?? declOf(rule, "background-color");
        if (color === undefined || fill === undefined) continue;
        const fg = resolveColor(color, colors);
        const stops = fillColors(fill, colors);
        if (fg === null || stops === null) continue;
        for (const stop of stops) {
          const ratio = contrast(fg, stop);
          if (ratio < 4.5) offenders.push(`${theme}: ${path.basename(rule.file)}: ${rule.selector}（${color} / ${stop} は ${ratio.toFixed(2)}:1）`);
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

// ---------- 焦点の輪（横断-06） ----------
// 影だけの輪は背景との差が 1.4〜2:1 で、Windows のハイコントラスト（強制色）では影ごと消えて印が無くなる。
// 焦点の輪は 2px の実線＋すき間で描く（影は足してよい）。

/** 焦点を移すだけの見出し・番号（tabIndex=-1。押せる部品ではないので輪を出さない） */
const PROGRAMMATIC_FOCUS = new Set([".offer-list__head:focus", ".claim-ticket__code:focus", ".claimed-title:focus"]);

describe("焦点の輪（横断-06）", () => {
  it("全体の既定: :focus-visible は 2px 以上の実線とすき間で描く", () => {
    const base = RULES.find((r) => r.selector === ":focus-visible" && r.at.length === 0);
    expect(base, ":focus-visible の既定の規則が無い").toBeDefined();
    expect(declOf(base!, "outline")).toMatch(/^(2|3)px solid /);
    expect(declOf(base!, "outline-offset")).toMatch(/^\d+px$/);
  });

  it("焦点の規則で輪を消さない（outline: none は、焦点を移すだけの見出し・番号だけ）", () => {
    const offenders = allRules()
      .filter((rule) => rule.selector.split(",").some((part) => /:focus/.test(part) && !PROGRAMMATIC_FOCUS.has(part.trim())))
      .filter((rule) => /^(none|0)$/.test(declOf(rule, "outline") ?? ""))
      .map((rule) => `${path.basename(rule.file)}: ${rule.selector}`);
    expect(offenders).toEqual([]);
  });

  it("目に出さない欄は、焦点が入ったら見える（store-sr-only--focusable）。ダイヤルの枠にも輪を映す", () => {
    const store = STORE_RULES;
    const reveal = store.filter((r) => r.selector.startsWith(".store-sr-only--focusable:focus"));
    expect(reveal.length, ".store-sr-only--focusable:focus / :focus-within の規則が無い").toBeGreaterThan(0);
    for (const rule of reveal) {
      expect(declOf(rule, "clip-path"), rule.selector).toBe("none");
      expect(declOf(rule, "position"), rule.selector).toBe("static");
    }
    const dialRing = store.find((r) => /:has\([^)]*:focus-visible\)/.test(r.selector) && /store-dial__rail/.test(r.selector));
    expect(dialRing, "ダイヤルの枠に焦点を映す規則が無い").toBeDefined();
    expect(declOf(dialRing!, "outline")).toMatch(/^(2|3)px solid /);
  });
});

// ---------- 指で押す部品の大きさ（横断-13） ----------
// ボタン・タブ・候補の行・チップは最小の高さ 2.75rem（44px）。ダイヤルの▲▼は 2.75rem の四角に近い形。
// 明暗の切り替えは右上に固定するので、その下に部品を置かない（店の画面ではタブの右端に重なっていた）。

const TAP_MIN = "var(--tap-min)";

/** 押す部品の規則と、そこで最小の高さを決めているか。 */
const TAP_TARGETS: Array<[string, string]> = [
  ["globals.css", "button"],
  ["globals.css", "nav > a"],
  ["globals.css", 'fieldset:has(input[type="checkbox"]) > label'],
  ["store.css", ".store-tab"],
  ["store.css", ".store-chip"],
  ["me.css", ".place-suggest__item"],
  ["me.css", ".budget-chip"],
];

describe("指で押す部品の大きさ（横断-13）", () => {
  const rules = allRules();

  it("--tap-min は 2.75rem（44px）", () => {
    const root = parseCss(GLOBALS).find((r) => r.selector === ":root" && r.at.length === 0);
    expect(root && declOf(root, "--tap-min")).toBe("2.75rem");
  });

  for (const [file, selector] of TAP_TARGETS) {
    it(`${selector}（${file}）は min-height が --tap-min`, () => {
      const rule = rules.find((r) => r.selector === selector && r.at.length === 0);
      expect(rule, `${file} に ${selector} の規則が無い`).toBeDefined();
      expect(declOf(rule!, "min-height")).toBe(TAP_MIN);
    });
  }

  it("ダイヤルの▲▼は高さ --tap-min（28px だった）。中央の帯の位置も同じ数から計算する", () => {
    const store = STORE_RULES;
    const step = store.find((r) => r.selector === ".store-dial__step");
    expect(step && declOf(step, "height")).toBe(TAP_MIN);
    const marker = store.find((r) => r.selector === ".store-dial__marker");
    expect(marker && declOf(marker, "top")).toContain(TAP_MIN);
  });

  it("「完了」と、その真下の「取り消す」のすき間は 0.75rem 以上（6px だった）", () => {
    const actions = STORE_RULES.find((r) => r.selector === ".store-arrival__actions");
    const gap = actions && declOf(actions, "gap");
    expect(gap).toMatch(/^\d+(\.\d+)?rem$/);
    expect(parseFloat(gap!)).toBeGreaterThanOrEqual(0.75);
  });

  it("明暗の切り替えは --theme-toggle-size の四角で、置く画面では main の上をその分あける（タブ・見出しに重ねない）", () => {
    const globals = RULES;
    const toggle = globals.find((r) => r.selector === ".theme-toggle");
    expect(toggle && declOf(toggle, "height")).toBe("var(--theme-toggle-size)");
    expect(toggle && declOf(toggle, "width")).toBe("var(--theme-toggle-size)");
    const root = globals.find((r) => r.selector === ":root" && r.at.length === 0)!;
    expect(parseFloat(declOf(root, "--theme-toggle-size") ?? "0")).toBeGreaterThanOrEqual(2.75);
    const reserve = globals.find((r) => r.selector.includes(".theme-toggle") && /\bmain$/.test(r.selector));
    expect(reserve, "明暗の切り替えがある画面の main の上をあける規則が無い").toBeDefined();
    const top = declOf(reserve!, "padding-top") ?? "";
    expect(top).toContain("var(--theme-toggle-top)");
    expect(top).toContain("var(--theme-toggle-size)");
    // 運営の画面は、殻のナビの右端をあけて同じ段に置く（ナビの下へずらすと、今度は一覧の右上に重なる）
    const adminNav = globals.find((r) => r.selector === '[data-testid="admin-nav"]');
    expect(adminNav && declOf(adminNav, "padding-inline-end")).toContain("var(--theme-toggle-size)");
  });
});

// ---------- 断りの出ている欄の赤枠（横断-05） ----------
describe("断りの出ている欄の赤枠（横断-05）", () => {
  it("赤枠は [aria-invalid] に付け、DOM の並び（欄の直後に断りの文）には頼らない", () => {
    const rules = allRules();
    expect(rules.filter((r) => /:has\(\+\s*\.msg\)/.test(r.selector)).map((r) => r.selector)).toEqual([]);
    const invalid = rules.find((r) => r.selector.split(",").map((s) => s.trim()).includes('[aria-invalid="true"]'));
    expect(invalid, '[aria-invalid="true"] の規則が無い').toBeDefined();
    expect(declOf(invalid!, "border-color")).toBe("var(--color-danger)");
    const dial = rules.find((r) => /:has\(\[aria-invalid="true"\]\)/.test(r.selector) && /store-dial__rail/.test(r.selector));
    expect(dial, "ダイヤルの枠を赤くする規則が無い").toBeDefined();
    expect(declOf(dial!, "border-color")).toBe("var(--color-danger)");
  });
});
