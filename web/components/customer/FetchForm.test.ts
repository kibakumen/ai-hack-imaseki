// 取得の入力の欄の値を、要求に載せる形へ直す所だけの検査（要件3の基準 3.11・3.12）。
// 画面の振る舞い（現在地・断りの表示・要求に載る値）は受け入れ検査 r03・r04 が見ているので、
// ここは**空欄の扱いの違い**だけを固定する——人数の空欄は項目を載せず（入口が「入れてください」と
// 答える）、予算の空欄は `null`（上限なし）で、この2つを取り違えると客に噛み合わない文が出る。
import { describe, expect, it } from "vitest";
import { budgetToSend, partyToSend } from "./FetchForm";

describe("人数の欄の値", () => {
  it("空欄は項目を載せない（undefined）", () => {
    expect(partyToSend("")).toBeUndefined();
    expect(partyToSend("   ")).toBeUndefined();
  });

  it("数は数として載る", () => {
    expect(partyToSend("3")).toBe(3);
    expect(partyToSend(" 0 ")).toBe(0);
  });

  it("数にならない文字はそのまま載る（判定は入口に任せる）", () => {
    expect(partyToSend("さんにん")).toBe("さんにん");
  });
});

describe("予算の上限の欄の値", () => {
  it("空欄は上限なし（null）", () => {
    expect(budgetToSend("")).toBeNull();
    expect(budgetToSend("  ")).toBeNull();
  });

  it("数は数として載り、数にならない文字はそのまま載る", () => {
    expect(budgetToSend("1500")).toBe(1500);
    expect(budgetToSend("いちまん")).toBe("いちまん");
  });
});
