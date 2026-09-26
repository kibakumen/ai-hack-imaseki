// 「向かっている客」の一覧の行（要件20の基準 20.1〜20.5・20.14〜20.16）と、完了済みにできるかの
// 判断（基準 20.6・20.7・20.12・20.13・20.19・20.24）。どちらも副作用なし・時計は引数。
//
// ⚠️ この2つは**受け入れ検査 r20 が API 越しに見る規則の正本**だが、r20 の該当する検査は客の
// 取り消し（タスク15）の入口を通るので、そこが揃うまで走らない。ここは同じ規則を関数のまま
// 押さえる（時刻の境目は、この検査でしか全部は見られない）。

import { describe, expect, it } from "vitest";
import { canComplete } from "../../lib/domain/reservation";
import { arrivalRows, COMPLETED_ROW_VIEW_MS, CUSTOMER_CANCELLED_ROW_VIEW_MS, publishPrefill, STORE_CANCELLED_ROW_VIEW_MS, type ArrivalRowInput, type LastOffer } from "../../lib/domain/storeHome";

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
        // 店が「来ない（枠が戻る）」で取り消した行だけ true（2026-09-26 本人選択）
        noShow: false,
      },
    ]);
  });

  // 2026-09-25 監査の指摘 横断-02: 自動の登録の仮の値（guest-… の呼び名・0000000000）が店の一覧へそのまま出て、
  // 存在しない番号の発信のリンクになっていた。店へ渡す手前で null にする（案A）。
  it("横断-02 自動の登録の仮の呼び名と仮の番号・消した客の空の値は null で渡す。自分で入れた値はそのまま", async () => {
    const { GUEST_PHONE_PLACEHOLDER } = await import("../../lib/domain/guest");
    const rows = arrivalRows(
      [
        row({ reservationId: "guest", nickname: "guest-k3j9x2", phone: GUEST_PHONE_PLACEHOLDER, expiresAt: at(10) }),
        row({ reservationId: "erased", nickname: "", phone: "", expiresAt: at(15) }),
        row({ reservationId: "named", nickname: "guest好きのたなか", phone: "09012345678", expiresAt: at(20) }),
      ],
      at(5),
      { storeBanned: false },
    );
    expect(rows.map(({ reservationId, nickname, phone }) => ({ reservationId, nickname, phone }))).toEqual([
      { reservationId: "guest", nickname: null, phone: null },
      { reservationId: "erased", nickname: null, phone: null },
      { reservationId: "named", nickname: "guest好きのたなか", phone: "09012345678" },
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

  it("20.15 運営に取り消された行は、いつでも出さない", () => {
    expect(kindsAt([row({ status: "admin_cancelled", changedAt: 5 })], 6)).toEqual([]);
    expect(kindsAt([row({ status: "admin_cancelled", changedAt: 5 })], 25)).toEqual([]);
  });

  // 2026-09-25 客の取り消しが店の画面に合図なく反映される件（横断-08）の案A: 黙って消さず、数分「客が取り消した」として残す。
  // 電話番号は出さない（もう連絡の要らない客・取り消した客の番号を店に見せ続けない）。
  it("横断-08 客が取り消した行は10分だけ「客が取り消した」として残り、電話番号を出さず、操作もできない", () => {
    const cancelled = row({ status: "customer_cancelled", changedAt: 5 });
    expect(CUSTOMER_CANCELLED_ROW_VIEW_MS).toBe(10 * MIN);
    expect(arrivalRows([cancelled], at(6), { storeBanned: false })[0]).toMatchObject({ kind: "customer_cancelled", phone: null, canComplete: false, canCancel: false });
    expect(kindsAt([cancelled], 14)).toEqual(["customer_cancelled"]);
    expect(kindsAt([cancelled], 15)).toEqual([]);
  });

  it("20.23 止められている店では、どの行も完了済みにできず取り消しもできない", () => {
    const rows = [row(), row({ reservationId: "res-2", expiresAt: at(15) })];
    const banned = arrivalRows(rows, at(18), { storeBanned: true });
    expect(banned.map((r) => r.kind)).toEqual(["expired", "active"]);
    for (const r of banned) expect({ id: r.reservationId, canComplete: r.canComplete, canCancel: r.canCancel }).toMatchObject({ canComplete: false, canCancel: false });
  });

  it("20.18 1件も無ければ空の一覧（出す行が全部消えたときも同じ）", () => {
    expect(arrivalRows([], at(5), { storeBanned: false })).toEqual([]);
    expect(arrivalRows([row({ status: "customer_cancelled", changedAt: 1 })], at(12), { storeBanned: false })).toEqual([]);
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

// 2026-09-25 監査の指摘 不具合-09: 前回の「何時まで」から日付を捨てて時分だけを今から解き直していたので、
// 先週金曜の「18:00まで」が、今が 06:00〜18:00 の間なら今日の 18:00 として初めの値に入っていた。
describe("publishPrefill の「何時まで」（基準 17.18・17.19）", () => {
  /** 日本時間の時刻（dayOffset は 2026-09-22 からの日数） */
  const jst = (hhmm: string, dayOffset = 0): Date => {
    const [h, m] = hhmm.split(":").map(Number);
    return new Date(Date.UTC(2026, 8, 22 + dayOffset, h - 9, m));
  };
  const last = (untilAt: Date, over: Partial<LastOffer> = {}): LastOffer => ({ initialCapacity: 3, capacity: 3, partyMax: 4, untilAt, couponIds: [], ...over });
  const untilAt = (lastUntil: Date, now: Date, over: Partial<LastOffer> = {}) => publishPrefill({ lastOffer: last(lastUntil, over), coupons: [], now }).until;

  it("前回が7日前の 18:00・今が 17:30 → 空欄（時分だけなら今日の 18:00 と読めてしまう）", () => {
    expect(untilAt(jst("18:00", -7), jst("17:30"))).toBeNull();
  });

  it("前回が昨日の 18:00・今が 06:00 → 空欄", () => {
    expect(untilAt(jst("18:00", -1), jst("06:00"))).toBeNull();
  });

  it("前回の終わりがまだ先（今より後で12時間以内）なら、その時分が入る。ちょうど今・12時間を1分でも超えると空欄", () => {
    expect(untilAt(jst("21:00"), jst("15:00"))).toBe("21:00");
    expect(untilAt(jst("02:00", 1), jst("15:00"))).toBe("02:00");
    expect(untilAt(jst("03:00", 1), jst("15:00"))).toBe("03:00");
    expect(untilAt(jst("03:01", 1), jst("15:00"))).toBeNull();
    expect(untilAt(jst("15:00"), jst("15:00"))).toBeNull();
  });

  it("店-05: 前回が「何時まで」を入れずに公開した（自動の終わり）なら空欄——自動の時刻を店が決めた時刻として持ち越さない", () => {
    expect(untilAt(jst("21:00"), jst("15:00"), { untilSet: false })).toBeNull();
  });
});
