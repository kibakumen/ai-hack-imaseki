// 確保の今の状態（要件11の基準 11.1・11.2・11.6）。保存する status は5つで、「期限切れ」だけは
// 時刻から導く——書き込みは起きない。

import { describe, expect, it } from "vitest";
import { canCancelByStore, effectiveState, isWithinExpiredGrace, RESERVATION_HOLD_MS } from "../../lib/domain/reservation";

const EXPIRES = new Date("2026-09-22T06:20:00.000Z");
const at = (minutesFromExpiry: number) => new Date(EXPIRES.getTime() + minutesFromExpiry * 60_000);

describe("effectiveState", () => {
  it("11.1 確保中は期限より前だけ。期限ちょうどから期限切れ（20分後に切れる・基準 8.4）", () => {
    expect(RESERVATION_HOLD_MS).toBe(20 * 60_000);
    expect(effectiveState({ status: "active", expiresAt: EXPIRES }, at(-1))).toBe("active");
    expect(effectiveState({ status: "active", expiresAt: EXPIRES }, EXPIRES)).toBe("expired");
    expect(effectiveState({ status: "active", expiresAt: EXPIRES }, at(1))).toBe("expired");
  });

  it("保存した状態は、期限を過ぎてもそのまま（期限切れへ倒すのは active だけ・基準 20.9）", () => {
    for (const status of ["completed", "customer_cancelled", "store_cancelled", "admin_cancelled"]) {
      expect(effectiveState({ status, expiresAt: EXPIRES }, at(60)), status).toBe(status);
    }
  });
});

describe("isWithinExpiredGrace", () => {
  it("11.6・20.13 期限から20分以内。ちょうど20分は、もう外", () => {
    expect(isWithinExpiredGrace({ status: "active", expiresAt: EXPIRES }, at(5))).toBe(true);
    expect(isWithinExpiredGrace({ status: "active", expiresAt: EXPIRES }, at(19))).toBe(true);
    expect(isWithinExpiredGrace({ status: "active", expiresAt: EXPIRES }, at(20))).toBe(false);
    expect(isWithinExpiredGrace({ status: "active", expiresAt: EXPIRES }, at(21))).toBe(false);
  });
});

// タスク18が足した（要件21の基準 21.1・21.5・21.6）
describe("canCancelByStore", () => {
  it("21.1 確保中だけ取り消せる。期限ちょうどからは取り消せない（期限切れ・基準 21.5）", () => {
    expect(canCancelByStore({ status: "active", expiresAt: EXPIRES }, at(-1))).toBe(true);
    expect(canCancelByStore({ status: "active", expiresAt: EXPIRES }, EXPIRES)).toBe(false);
    expect(canCancelByStore({ status: "active", expiresAt: EXPIRES }, at(5))).toBe(false);
  });

  it("21.5・21.6 完了済み・客が取り消した・店が取り消した・運営に取り消された確保は取り消せない", () => {
    for (const status of ["completed", "customer_cancelled", "store_cancelled", "admin_cancelled"]) {
      expect(canCancelByStore({ status, expiresAt: EXPIRES }, at(-1)), status).toBe(false);
    }
  });
});
