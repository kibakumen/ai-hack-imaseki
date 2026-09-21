// 「最近行った店」と通報を受け付ける期間（要件26の基準 26.10・26.15・26.18）。
import { describe, expect, it } from "vitest";
import { RECENT_STORE_WINDOW_MS, isWithinRecentWindow, recentWindowStart } from "./report";

const NOW = new Date("2026-09-29T06:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const MIN = 60_000;

describe("isWithinRecentWindow", () => {
  it("7日は24時間×7（一覧に出す期間と、通報を受け付ける期間が同じ値）", () => {
    expect(RECENT_STORE_WINDOW_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("7日に1分足りなければ内、ちょうど7日と8日は外", () => {
    expect(isWithinRecentWindow(ago(RECENT_STORE_WINDOW_MS - MIN), NOW)).toBe(true);
    expect(isWithinRecentWindow(ago(RECENT_STORE_WINDOW_MS), NOW)).toBe(false);
    expect(isWithinRecentWindow(ago(8 * 24 * 60 * MIN), NOW)).toBe(false);
  });

  it("今と、今より後（時計のずれ）も内", () => {
    expect(isWithinRecentWindow(NOW, NOW)).toBe(true);
    expect(isWithinRecentWindow(new Date(NOW.getTime() + MIN), NOW)).toBe(true);
  });
});

describe("recentWindowStart", () => {
  it("境目は今から7日前。SQL の「より後」と合わせると isWithinRecentWindow と同じ線になる", () => {
    const start = recentWindowStart(NOW);
    expect(start.toISOString()).toBe("2026-09-22T06:00:00.000Z");
    // 「境目より後」＝内。境目そのものは外（ちょうど7日は外）。
    expect(ago(RECENT_STORE_WINDOW_MS - MIN).getTime() > start.getTime()).toBe(true);
    expect(ago(RECENT_STORE_WINDOW_MS).getTime() > start.getTime()).toBe(false);
  });
});
