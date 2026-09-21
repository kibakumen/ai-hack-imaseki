// 受け取れる状態（要件5の基準 5.2・要件17の基準 17.13・17.14・要件18の基準 18.12・18.13）。
// SQL 側（repo/sqlFragments.ts）との突き合わせは受け入れ検査 r05・r18 が見る。

import { describe, expect, it } from "vitest";
import { isReceivable } from "../../lib/domain/offer";

const iso = (s: string) => new Date(s);
const UNTIL = iso("2026-09-22T08:00:00.000Z");

describe("isReceivable", () => {
  it("公開中で残りが1以上なら受け取れる", () => {
    expect(isReceivable({ endedAt: null, untilAt: UNTIL, remaining: 1 }, iso("2026-09-22T06:00:00.000Z"))).toBe(true);
  });

  it("17.13 店が止めた（ended_at が入った）オファーは受け取れない", () => {
    expect(isReceivable({ endedAt: iso("2026-09-22T06:30:00.000Z"), untilAt: UNTIL, remaining: 3 }, iso("2026-09-22T06:40:00.000Z"))).toBe(false);
  });

  it("17.14 「何時まで」の時刻ちょうどから受け取れない", () => {
    expect(isReceivable({ endedAt: null, untilAt: UNTIL, remaining: 3 }, UNTIL)).toBe(false);
    expect(isReceivable({ endedAt: null, untilAt: UNTIL, remaining: 3 }, new Date(UNTIL.getTime() - 1))).toBe(true);
  });

  it("18.12・18.13 残り0は受け取れず、1以上に戻れば受け取れる", () => {
    const now = iso("2026-09-22T06:00:00.000Z");
    expect(isReceivable({ endedAt: null, untilAt: UNTIL, remaining: 0 }, now)).toBe(false);
    expect(isReceivable({ endedAt: null, untilAt: UNTIL, remaining: -1 }, now)).toBe(false);
    expect(isReceivable({ endedAt: null, untilAt: UNTIL, remaining: 1 }, now)).toBe(true);
  });
});
