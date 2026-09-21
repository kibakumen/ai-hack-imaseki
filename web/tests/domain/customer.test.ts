// 登録を消せるかの判断（要件28の基準 28.5 と、17節の持ち越しの猶予）。
import { describe, expect, it } from "vitest";
import { canDeleteRegistration } from "../../lib/domain/customer";
import { EXPIRED_GRACE_MS } from "../../lib/domain/reservation";

const NOW = new Date("2026-09-22T06:00:00.000Z");
/** 期限が「今から ms 後（負なら前）」の確保1行。 */
const row = (status: string, expiresFromNowMs: number) => ({ status, expiresAt: new Date(NOW.getTime() + expiresFromNowMs) });

describe("canDeleteRegistration", () => {
  it("確保が1件も無ければ消せる", () => {
    expect(canDeleteRegistration([], NOW)).toEqual({ ok: true });
  });

  it("確保中の確保があると消せない（基準 28.5）", () => {
    expect(canDeleteRegistration([row("active", 60_000)], NOW)).toEqual({ ok: false, kind: "has_active_reservation" });
  });

  it("期限から20分以内の期限切れの確保があると消せない。ちょうど20分は消せる（17節の持ち越し）", () => {
    expect(canDeleteRegistration([row("active", -(EXPIRED_GRACE_MS - 1))], NOW).ok).toBe(false);
    expect(canDeleteRegistration([row("active", -EXPIRED_GRACE_MS)], NOW).ok).toBe(true);
  });

  it("取り消された確保・完了済みの確保は、いつのものでも消すのを止めない", () => {
    const done = [row("completed", -60_000), row("customer_cancelled", -60_000), row("store_cancelled", -60_000), row("admin_cancelled", -60_000)];
    expect(canDeleteRegistration(done, NOW)).toEqual({ ok: true });
  });

  it("1件でも止める確保があれば消せない（ほかが全部済んでいても）", () => {
    expect(canDeleteRegistration([row("completed", -10 * 60_000), row("active", 60_000)], NOW).ok).toBe(false);
  });
});
