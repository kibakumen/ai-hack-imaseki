// 残りの数（要件18）。SQL の側（repo/sqlFragments.ts の `holdsSlotCondition`・
// `remainingExpression`）との突き合わせは受け入れ検査 r18 が見るので、ここは3つの「押さえている」
// の場合分けと、押さえていない状態を固定する。

import { describe, expect, it } from "vitest";
import { holdsSlot, remainingOf } from "../../lib/domain/remaining";

const NOW = new Date("2026-09-22T06:10:00.000Z");
const FUTURE = new Date("2026-09-22T06:20:00.000Z");
const PAST = new Date("2026-09-22T06:05:00.000Z");

describe("holdsSlot", () => {
  it("確保中で期限より前なら押さえている。期限ちょうど・期限を過ぎたら押さえていない（18.3）", () => {
    expect(holdsSlot({ status: "active", expiresAt: FUTURE, holdsSlot: 1 }, NOW)).toBe(true);
    expect(holdsSlot({ status: "active", expiresAt: NOW, holdsSlot: 1 }, NOW)).toBe(false);
    expect(holdsSlot({ status: "active", expiresAt: PAST, holdsSlot: 1 }, NOW)).toBe(false);
  });

  it("18.7・18.8 完了済みは holds_slot の値で決まる（期限切れから完了済みにしたものは0のことがある）", () => {
    expect(holdsSlot({ status: "completed", expiresAt: PAST, holdsSlot: 1 }, NOW)).toBe(true);
    expect(holdsSlot({ status: "completed", expiresAt: PAST, holdsSlot: 0 }, NOW)).toBe(false);
  });

  it("18.4 店が取り消した確保は、期限を過ぎても押さえたまま。客と運営の取り消しは戻る（18.2・18.6）", () => {
    expect(holdsSlot({ status: "store_cancelled", expiresAt: PAST, holdsSlot: 1 }, NOW)).toBe(true);
    expect(holdsSlot({ status: "customer_cancelled", expiresAt: FUTURE, holdsSlot: 1 }, NOW)).toBe(false);
    expect(holdsSlot({ status: "admin_cancelled", expiresAt: FUTURE, holdsSlot: 1 }, NOW)).toBe(false);
  });
});

describe("remainingOf", () => {
  it("18.10 確保が1件も無ければ、残りは募集する組数と同じ", () => {
    expect(remainingOf(3, [], NOW)).toBe(3);
  });

  it("18.1 押さえている確保の数だけ減り、押さえていない行は数えない", () => {
    const rows = [
      { status: "active", expiresAt: FUTURE, holdsSlot: 1 },
      { status: "completed", expiresAt: PAST, holdsSlot: 1 },
      { status: "store_cancelled", expiresAt: PAST, holdsSlot: 1 },
      { status: "active", expiresAt: PAST, holdsSlot: 1 },
      { status: "customer_cancelled", expiresAt: FUTURE, holdsSlot: 1 },
      { status: "completed", expiresAt: PAST, holdsSlot: 0 },
    ];
    expect(remainingOf(5, rows, NOW)).toBe(2);
  });

  it("0 では畳まない（SQL の式と同じ答えを出すのがこの関数の仕事。畳むのは画面に出す側）", () => {
    expect(remainingOf(1, [{ status: "active", expiresAt: FUTURE, holdsSlot: 1 }, { status: "store_cancelled", expiresAt: PAST, holdsSlot: 1 }], NOW)).toBe(-1);
  });
});
