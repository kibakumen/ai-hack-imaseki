// 確定の演出の8桁の番号が、狭いスマホ（幅320px・360px）で半券の枠に収まる（2026-09-25 監査の指摘 客-14）。
//
// 以前は clamp(2.5rem, 15vw, 3.75rem)・字間 0.1em で、別の担当者がヘッドレスの Chromium で確かめたところ
// 幅360pxで最後の桁が枠の端に触れ、320pxでは最後の字が切れた。jsdom は字の幅を測れないので、me.css の値から
// 等幅の字（1字 ≒ 0.6em）で幅を見積もり、札の中身の幅（画面幅 − 外の余白 − 札の余白）と比べる。

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = fs.readFileSync(path.join(__dirname, "..", "app", "me", "me.css"), "utf8");
const REM = 16;
/** 等幅の字1つの幅（em）。ui-monospace・SFMono・一般的な等幅体はおおむね 0.6em */
const MONO_ADVANCE_EM = 0.6;
/** 外の余白（`.claimed-celebration-inner` の左右 1.25rem）と札の余白（`.claimed-ticket` の左右 1.25rem） */
const SIDE_PADDING_PX = 2 * 1.25 * REM + 2 * 1.25 * REM;

const ruleBody = (selector: string): string => {
  const at = CSS.indexOf(`${selector} {`);
  expect(at, `${selector} の規則が無い`).toBeGreaterThanOrEqual(0);
  return CSS.slice(at, CSS.indexOf("}", at));
};

/** `clamp(Arem, Bvw, Crem)` を、その画面幅での px に直す */
const clampPx = (value: string, viewport: number): number => {
  const m = value.match(/clamp\(\s*([\d.]+)rem\s*,\s*([\d.]+)vw\s*,\s*([\d.]+)rem\s*\)/);
  expect(m, `clamp の形でない: ${value}`).not.toBeNull();
  const [min, vw, max] = [Number(m![1]) * REM, (Number(m![2]) * viewport) / 100, Number(m![3]) * REM];
  return Math.min(max, Math.max(min, vw));
};

describe("確定の演出の番号の大きさ（客-14）", () => {
  const body = ruleBody(".claimed-ticket__code");
  const fontSize = body.match(/font-size:\s*([^;]+);/)![1];
  const spacingEm = Number(body.match(/letter-spacing:\s*([\d.]+)em/)![1]);

  it.each([320, 360, 390])("幅 %ipx で、8桁の番号が札の中身の幅に収まる", (viewport) => {
    const px = clampPx(fontSize, viewport);
    const codeWidth = 8 * px * (MONO_ADVANCE_EM + spacingEm);
    expect(codeWidth).toBeLessThan(viewport - SIDE_PADDING_PX);
  });
});
