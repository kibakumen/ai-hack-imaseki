// 「向かっている客」の一覧の行（要件20の基準 20.1〜20.5・20.14〜20.16）と、完了済みにできるかの
// 判断（基準 20.6・20.7・20.12・20.13・20.19・20.24）。どちらも副作用なし・時計は引数。
//
// ⚠️ この2つは**受け入れ検査 r20 が API 越しに見る規則の正本**だが、r20 の該当する検査は客の
// 取り消し（タスク15）の入口を通るので、そこが揃うまで走らない。ここは同じ規則を関数のまま
// 押さえる（時刻の境目は、この検査でしか全部は見られない）。

import { describe, expect, it } from "vitest";
import { canComplete } from "./reservation";
import { arrivalRows, COMPLETED_ROW_VIEW_MS, STORE_CANCELLED_ROW_VIEW_MS, type ArrivalRowInput } from "./storeHome";

const MIN = 60_000;
const T0 = new Date("2026-09-22T06:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * MIN);

/** 受け取りは T0、期限は T0+20分（基準 8.4）。状態が変わった時刻は `changedAt` で動かす。 */
const row = (over: Partial<ArrivalRowInput> & { changedAt?: number } = {}): ArrivalRowInput => ({
  reservationId: "res-1",
  status: "active",
  expiresAt: at(20),
  statusAt: over.changedAt === undefined ? T0 : at(over.changedAt),
  nickname: "たなか",
  phone: "09012345678",
  party: 2,
  code: "12345678",
  hasNewerReservation: false,
  ...over,
});

const kindsAt = (rows: ArrivalRowInput[], minutes: number) => arrivalRows(rows, at(minutes), { storeBanned: false }).map((r) => r.kind);

describe("arrivalRows", () => {
  it("20.1 確保中の行は呼び名・電話番号・人数・コード・期限の5項目を持ち、完了済みと取り消しができる", () => {
    expect(arrivalRows([row()], at(5), { storeBanned: false })).toEqual([
      {
        reservationId: "res-1",
        kind: "active",
        nickname: "たなか",
        phone: "09012345678",
        party: 2,
        code: "12345678",
        expiresAt: at(20).toISOString(),
        canComplete: true,
        canCancel: true,
      },
    ]);
  });

  it("20.2 期限の近い順に並ぶ（入れた順ではない）", () => {
    const rows = [
      row({ reservationId: "late", expiresAt: at(40) }),
      row({ reservationId: "soon", expiresAt: at(10) }),
      row({ reservationId: "mid", expiresAt: at(25) }),
    ];
    expect(arrivalRows(rows, at(5), { storeBanned: false }).map((r) => r.reservationId)).toEqual(["soon", "mid", "late"]);
  });

  it("20.5 期限切れの行は20分だけ残り、完了済みにはできるが取り消しはできない", () => {
    expect(kindsAt([row()], 25)).toEqual(["expired"]);
    expect(arrivalRows([row()], at(25), { storeBanned: false })[0]).toMatchObject({ kind: "expired", canComplete: true, canCancel: false });
    // 期限＋20分ちょうどは、もう外（客の側の表示と同じ線・基準 11.6）
    expect(kindsAt([row()], 40)).toEqual([]);
    expect(kindsAt([row()], 41)).toEqual([]);
  });

  it("20.12 期限切れの客が新しい確保を作ったら、その行は消えて完了済みにもできない", () => {
    expect(kindsAt([row({ hasNewerReservation: true })], 25)).toEqual([]);
    // 確保中のうちは、新しい確保が在っても出し続ける（消えるのは期限切れの行だけ）
    expect(kindsAt([row({ hasNewerReservation: true })], 5)).toEqual(["active"]);
  });

  it("20.14 完了済みの行は24時間残り、戻す操作の対象にならない（できる操作が2つとも false）", () => {
    const completed = row({ status: "completed", changedAt: 5 });
    expect(COMPLETED_ROW_VIEW_MS).toBe(24 * 60 * MIN);
    expect(arrivalRows([completed], at(25), { storeBanned: false })[0]).toMatchObject({ kind: "completed", canComplete: false, canCancel: false });
    expect(kindsAt([completed], 5 + 24 * 60 - 1)).toEqual(["completed"]);
    expect(kindsAt([completed], 5 + 24 * 60)).toEqual([]);
  });

  it("20.16 店が取り消した行は20分だけ、電話番号とともに残る", () => {
    const cancelled = row({ status: "store_cancelled", changedAt: 10 });
    expect(STORE_CANCELLED_ROW_VIEW_MS).toBe(20 * MIN);
    expect(arrivalRows([cancelled], at(25), { storeBanned: false })[0]).toMatchObject({ kind: "store_cancelled", phone: "09012345678", canComplete: false, canCancel: false });
    expect(kindsAt([cancelled], 29)).toEqual(["store_cancelled"]);
    expect(kindsAt([cancelled], 31)).toEqual([]);
  });

  it("20.15 客が取り消した行と運営に取り消された行は、いつでも出さない", () => {
    for (const status of ["customer_cancelled", "admin_cancelled"]) {
      expect(kindsAt([row({ status, changedAt: 5 })], 6), status).toEqual([]);
      expect(kindsAt([row({ status, changedAt: 5 })], 25), status).toEqual([]);
    }
  });

  it("20.23 止められている店では、どの行も完了済みにできず取り消しもできない", () => {
    const rows = [row(), row({ reservationId: "res-2", expiresAt: at(15) })];
    const banned = arrivalRows(rows, at(18), { storeBanned: true });
    expect(banned.map((r) => r.kind)).toEqual(["expired", "active"]);
    for (const r of banned) expect({ id: r.reservationId, canComplete: r.canComplete, canCancel: r.canCancel }).toMatchObject({ canComplete: false, canCancel: false });
  });

  it("20.18 1件も無ければ空の一覧（出す行が全部消えたときも同じ）", () => {
    expect(arrivalRows([], at(5), { storeBanned: false })).toEqual([]);
    expect(arrivalRows([row({ status: "customer_cancelled", changedAt: 1 })], at(5), { storeBanned: false })).toEqual([]);
  });
});

describe("canComplete", () => {
  const target = (over: Partial<Parameters<typeof canComplete>[0]> = {}) => ({
    status: "active",
    expiresAt: at(20),
    hasNewerReservation: false,
    storeBanned: false,
    ...over,
  });

  it("20.6・20.7・20.13 できるのは確保中と、期限から20分以内の期限切れだけ", () => {
    expect(canComplete(target(), at(5))).toBe(true);
    expect(canComplete(target(), at(25))).toBe(true);
    expect(canComplete(target(), at(39))).toBe(true);
    expect(canComplete(target(), at(40))).toBe(false);
    expect(canComplete(target(), at(41))).toBe(false);
  });

  it("20.12 期限切れの客が新しい確保を作っていたら、できない（確保中なら関係ない）", () => {
    expect(canComplete(target({ hasNewerReservation: true }), at(25))).toBe(false);
    expect(canComplete(target({ hasNewerReservation: true }), at(5))).toBe(true);
  });

  it("20.19 既に完了済み・客が取り消した・店が取り消した・運営に取り消された確保は、できない", () => {
    for (const status of ["completed", "customer_cancelled", "store_cancelled", "admin_cancelled"]) {
      expect(canComplete(target({ status }), at(5)), status).toBe(false);
      expect(canComplete(target({ status }), at(25)), status).toBe(false);
    }
  });

  it("20.24 止められている店では、確保中でも期限切れでもできない", () => {
    expect(canComplete(target({ storeBanned: true }), at(5))).toBe(false);
    expect(canComplete(target({ storeBanned: true }), at(25))).toBe(false);
  });
});
