// クーポンの入力の形の境目（要件16の基準 16.3）。受け入れ検査は入口を通して見るので、
// ここでは境目の1字ずつを直に固定する（40字は通り41字は断る、の「1字」が動いたら落ちる）。
import { describe, expect, it } from "vitest";
import { couponSchema } from "./coupon";
import { COUPON_NAME_MAX, COUPON_NOTE_MAX } from "./limits";

const reasonsOf = (input: unknown): string[] => {
  const parsed = couponSchema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map((issue) => String(issue.path[0]));
};

describe("クーポンの入力の形", () => {
  it("名前は1字以上40字以内（0字と41字は断る）", () => {
    expect(reasonsOf({ name: "", note: "" })).toEqual(["name"]);
    expect(reasonsOf({ name: "あ".repeat(COUPON_NAME_MAX + 1), note: "" })).toEqual(["name"]);
    expect(reasonsOf({ name: "あ", note: "" })).toEqual([]);
    expect(reasonsOf({ name: "あ".repeat(COUPON_NAME_MAX), note: "" })).toEqual([]);
  });

  it("特記事項は100字まで（101字は断る）。項目ごと無くても通る", () => {
    expect(reasonsOf({ name: "生ビール1杯", note: "い".repeat(COUPON_NOTE_MAX + 1) })).toEqual(["note"]);
    expect(reasonsOf({ name: "生ビール1杯", note: "い".repeat(COUPON_NOTE_MAX) })).toEqual([]);
    expect(reasonsOf({ name: "生ビール1杯" })).toEqual([]);
  });

  it("名前と特記事項の両方が範囲の外なら、どちらも返す（どの項目かが分かる）", () => {
    expect(reasonsOf({ name: "", note: "い".repeat(COUPON_NOTE_MAX + 1) }).sort()).toEqual(["name", "note"]);
  });
});
