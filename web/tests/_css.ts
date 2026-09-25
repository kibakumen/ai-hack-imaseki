// 画面の CSS を読む検査の道具（2026-09-25 監査の指摘 横断-04・横断-06・横断-10・横断-13・設計-11）。
// 検査は描かずに CSS の宣言を読む——jsdom は CSS の配色も大きさも計算しないので、決めごと（どの変数で塗るか・
// 焦点の輪の形・押せる面の大きさ）は宣言の側で確かめるしかない。
import fs from "node:fs";
import path from "node:path";

export const WEB = path.resolve(__dirname, "..");

const walk = (dir: string, keep: (f: string) => boolean): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return ["node_modules", ".next", ".open-next", ".wrangler"].includes(entry.name) ? [] : walk(p, keep);
    return keep(p) ? [p] : [];
  });

/** 画面の CSS（app と components の下の .css 全部）。 */
export const cssFiles = (): string[] => [...walk(path.join(WEB, "app"), (f) => f.endsWith(".css")), ...walk(path.join(WEB, "components"), (f) => f.endsWith(".css"))];

/** 画面のソース（検査を除く .ts・.tsx）。CSS の class が使われているかを見るため。 */
export const uiSources = (): string[] =>
  [...walk(path.join(WEB, "app"), (f) => /\.tsx?$/.test(f)), ...walk(path.join(WEB, "components"), (f) => /\.tsx?$/.test(f))].filter((f) => !/\.test\.tsx?$/.test(f));

export const readCss = (file: string): string => fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

export type CssDecl = { prop: string; value: string };
/** 1つの規則。`at` は囲んでいる @media・@supports の前置き（外側から順）。 */
export type CssRule = { file: string; selector: string; at: string[]; decls: CssDecl[] };

const declsOf = (body: string): CssDecl[] =>
  body
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.includes(":"))
    .map((part) => {
      const at = part.indexOf(":");
      return { prop: part.slice(0, at).trim(), value: part.slice(at + 1).trim() };
    });

/**
 * CSS を規則の並びにする（入れ子の @media・@supports は `at` に積む。@keyframes の中身は規則にしない）。
 * 画面の CSS が使う形（入れ子の規則を書かない素の CSS）だけを読めればよい。
 */
export const parseCss = (file: string): CssRule[] => {
  const text = readCss(file);
  const rules: CssRule[] = [];
  const stack: Array<{ kind: "at" | "keyframes"; prelude: string }> = [];
  let i = 0;
  let start = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "{") {
      const prelude = text.slice(start, i).trim();
      if (prelude.startsWith("@keyframes") || stack.some((s) => s.kind === "keyframes")) {
        stack.push({ kind: "keyframes", prelude });
        i += 1;
        start = i;
        continue;
      }
      if (prelude.startsWith("@")) {
        stack.push({ kind: "at", prelude });
        i += 1;
        start = i;
        continue;
      }
      const end = text.indexOf("}", i);
      rules.push({ file, selector: prelude.replace(/\s+/g, " "), at: stack.map((s) => s.prelude), decls: declsOf(text.slice(i + 1, end)) });
      i = end + 1;
      start = i;
      continue;
    }
    if (ch === "}") {
      stack.pop();
      i += 1;
      start = i;
      continue;
    }
    if (ch === ";" && stack.length > 0 && stack[stack.length - 1].kind === "at") start = i + 1;
    i += 1;
  }
  return rules;
};

/** 全部の CSS の規則。 */
export const allRules = (): CssRule[] => cssFiles().flatMap(parseCss);

/** 規則の中の、ある名前の宣言の値（無ければ undefined）。 */
export const declOf = (rule: CssRule, prop: string): string | undefined => rule.decls.find((d) => d.prop === prop)?.value;

// ---------- 色の変数と明るさの比 ----------

type Rgb = [number, number, number];

const hexToRgb = (hex: string): Rgb => {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16)) as Rgb;
};

const luminance = ([r, g, b]: Rgb): number => {
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
};

/** WCAG 2.x の明るさの比。 */
export const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(hexToRgb(a)), luminance(hexToRgb(b))].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** `color-mix(in srgb, A p%, B)` を sRGB の値の上で混ぜる（ブラウザと同じ式・不透明な色どうしのときだけ）。 */
const mix = (a: Rgb, b: Rgb, p: number): Rgb => a.map((v, i) => Math.round(v * p + b[i] * (1 - p))) as Rgb;

const rgbToHex = (rgb: Rgb): string => `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

export type Palette = Record<string, string>;

/**
 * globals.css の色の変数。明るい設定は `:root`、暗い設定は `:root[data-theme="dark"]` で上書きした値。
 * `--color-*` から導く色の変数（ホバーの `--hover-soft-bg` など）も、その配色の値に直して入れる
 * （2026-09-25 横断-04 のレビュー。入れないと `var(--hover-soft-bg)` の地が読めず、その組が黙って検査から漏れた）。
 */
export const palette = (theme: "light" | "dark"): Palette => {
  const rules = parseCss(path.join(WEB, "app", "globals.css"));
  const declsAt = (selector: string) => rules.filter((r) => r.selector === selector && r.at.length === 0).flatMap((r) => r.decls);
  const pick = (selector: string): Palette =>
    Object.fromEntries(
      declsAt(selector)
        .filter((d) => d.prop.startsWith("--color-") && /^#[0-9a-fA-F]{3,8}$/.test(d.value))
        .map((d) => [d.prop, d.value]),
    );
  const light = pick(":root");
  const colors = theme === "light" ? light : { ...light, ...pick(':root[data-theme="dark"]') };
  const derived = [...declsAt(":root"), ...(theme === "dark" ? declsAt(':root[data-theme="dark"]') : [])]
    .filter((d) => d.prop.startsWith("--") && !d.prop.startsWith("--color-"))
    .map((d) => [d.prop, resolveColor(d.value, colors)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== null);
  return { ...colors, ...Object.fromEntries(derived) };
};

/**
 * 色の式を今の配色の値にする。読めるのは `var(--color-…)` と、その `color-mix(in srgb, X p%, Y)`（入れ子も可）。
 * 透明を混ぜる式・読めない式は null（検査の側で「読めない塗り」として扱う）。
 */
export const resolveColor = (expr: string, colors: Palette): string | null => {
  const text = expr.trim();
  const variable = /^var\(\s*(--[-\w]+)\s*\)$/.exec(text);
  if (variable) return colors[variable[1]] ?? null;
  if (/^#[0-9a-fA-F]{3,8}$/.test(text)) return text;
  const m = /^color-mix\(\s*in srgb\s*,([\s\S]*)\)$/.exec(text);
  if (!m) return null;
  // 最上位の「,」で2つに割る
  const inner = m[1];
  let depth = 0;
  let cut = -1;
  for (let k = 0; k < inner.length; k += 1) {
    if (inner[k] === "(") depth += 1;
    if (inner[k] === ")") depth -= 1;
    if (inner[k] === "," && depth === 0) {
      cut = k;
      break;
    }
  }
  if (cut < 0) return null;
  const [left, right] = [inner.slice(0, cut).trim(), inner.slice(cut + 1).trim()];
  const pct = /\s(\d+(?:\.\d+)?)%$/.exec(left);
  const leftColor = resolveColor(pct ? left.slice(0, pct.index) : left, colors);
  const rightColor = resolveColor(right.replace(/\s\d+(?:\.\d+)?%$/, ""), colors);
  if (leftColor === null || rightColor === null) return null;
  return rgbToHex(mix(hexToRgb(leftColor), hexToRgb(rightColor), pct ? Number(pct[1]) / 100 : 0.5));
};

/**
 * 塗り（background）の値から、地の色の候補を全部取り出す。単色ならその1つ、グラデーションなら止まりの色の全部。
 * 読めない色が1つでも在れば null。
 */
export const fillColors = (value: string, colors: Palette): string[] | null => {
  const bare = value.replace(/\s*!important\s*$/, "").trim();
  const gradient = /^(?:linear|radial)-gradient\(([\s\S]*)\)$/.exec(bare);
  const parts: string[] = [];
  if (gradient) {
    let depth = 0;
    let from = 0;
    const inner = gradient[1];
    for (let k = 0; k <= inner.length; k += 1) {
      const c = inner[k];
      if (c === "(") depth += 1;
      if (c === ")") depth -= 1;
      if ((c === "," && depth === 0) || k === inner.length) {
        parts.push(inner.slice(from, k).trim());
        from = k + 1;
      }
    }
  } else parts.push(bare);
  const stops = parts.filter((p) => !/^\d+deg$|^to\s/.test(p)).map((p) => p.replace(/\s+\d+(?:\.\d+)?%$/, ""));
  const resolved = stops.map((s) => resolveColor(s, colors));
  return resolved.some((c) => c === null) ? null : (resolved as string[]);
};

// ---------- 詳細度 ----------

export type Specificity = [number, number, number];

/** 詳細度を比べる（a が強ければ正、弱ければ負、同じなら 0）。 */
export const compareSpecificity = (a: Specificity, b: Specificity): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** 閉じ括弧の位置（`open` は開き括弧の位置）。 */
const closingParen = (text: string, open: number): number => {
  let depth = 0;
  for (let k = open; k < text.length; k += 1) {
    if (text[k] === "(") depth += 1;
    if (text[k] === ")") {
      depth -= 1;
      if (depth === 0) return k;
    }
  }
  return text.length - 1;
};

/** 最上位の「,」で割る（括弧の中の「,」では割らない）。 */
export const splitSelectorList = (list: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let k = 0; k <= list.length; k += 1) {
    const c = list[k];
    if (c === "(" || c === "[") depth += 1;
    if (c === ")" || c === "]") depth -= 1;
    if ((c === "," && depth === 0) || k === list.length) {
      parts.push(list.slice(from, k).trim());
      from = k + 1;
    }
  }
  return parts.filter((p) => p !== "");
};

const LEGACY_PSEUDO_ELEMENTS = new Set(["before", "after", "first-line", "first-letter"]);
const IDENT = /^-?[_a-zA-Z][-_a-zA-Z0-9]*/;

/**
 * 1つのセレクタ（「,」で割ったあとの1つ）の詳細度（Selectors Level 4 の数え方）。
 * `:is()`・`:not()`・`:has()` は中のいちばん強いもの、`:where()` は 0、ほかの `:x()` は疑似クラス1つ。
 */
export const specificity = (selector: string): Specificity => {
  const acc: Specificity = [0, 0, 0];
  const add = (s: Specificity) => s.forEach((v, i) => (acc[i] += v));
  let k = 0;
  while (k < selector.length) {
    const c = selector[k];
    const rest = selector.slice(k + 1);
    if (c === "#") {
      acc[0] += 1;
      k += 1 + (IDENT.exec(rest)?.[0].length ?? 0);
    } else if (c === ".") {
      acc[1] += 1;
      k += 1 + (IDENT.exec(rest)?.[0].length ?? 0);
    } else if (c === "[") {
      acc[1] += 1;
      k = selector.indexOf("]", k) + 1;
    } else if (c === ":" && selector[k + 1] === ":") {
      acc[2] += 1;
      k += 2 + (IDENT.exec(selector.slice(k + 2))?.[0].length ?? 0);
      if (selector[k] === "(") k = closingParen(selector, k) + 1;
    } else if (c === ":") {
      const name = IDENT.exec(rest)?.[0] ?? "";
      k += 1 + name.length;
      if (selector[k] === "(") {
        const end = closingParen(selector, k);
        const inner = selector.slice(k + 1, end);
        k = end + 1;
        if (name === "where") continue;
        if (["is", "not", "has"].includes(name)) {
          const strongest = splitSelectorList(inner)
            .map(specificity)
            .reduce<Specificity>((best, s) => (compareSpecificity(s, best) > 0 ? s : best), [0, 0, 0]);
          add(strongest);
          continue;
        }
        acc[1] += 1;
        continue;
      }
      if (LEGACY_PSEUDO_ELEMENTS.has(name)) acc[2] += 1;
      else acc[1] += 1;
    } else if (IDENT.test(selector.slice(k))) {
      acc[2] += 1;
      k += IDENT.exec(selector.slice(k))![0].length;
    } else k += 1;
  }
  return acc;
};

/** セレクタの主語（いちばん右の複合セレクタ）。括弧の中は落として返す（`:has(input)` の input を主語と読まない）。 */
export const subjectOf = (selector: string): string => {
  let flat = "";
  let depth = 0;
  for (const c of selector) {
    if (c === "(") depth += 1;
    if (depth === 0) flat += c;
    if (c === ")") depth -= 1;
  }
  const parts = flat.trim().split(/\s*[\s>+~]\s*/);
  return parts[parts.length - 1] ?? "";
};
