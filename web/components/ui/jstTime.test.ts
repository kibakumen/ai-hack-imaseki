// 画面の時刻の書き方（2026-09-22 タスク25 の「揃え」で `components/store/jstTime.ts` を
// ここへ寄せたときに足した）。寄せ先が1つになったので、書き方の決めもここで固定する。
//
// 受け入れ検査が直接は見ない2つを押さえる:
//   ①日本時間への寄せ方（UTC からの +9時間。日をまたぐ時刻で確かめる）
//   ②読めない値で表示を止めないこと（空文字を返す）
import { describe, expect, it } from "vitest";
import { dateTimeInJst, timeInJst } from "./jstTime";

describe("画面に出す日本時間", () => {
  it("UTC の時刻を +9時間して HH:MM にする", () => {
    expect(timeInJst("2026-09-22T06:00:00.000Z")).toBe("15:00");
    expect(timeInJst("2026-09-22T00:05:00.000Z")).toBe("09:05");
  });

  it("日をまたぐ時刻は、日付の側も日本時間で動く", () => {
    // 2026-09-22 20:30Z は日本時間で翌日の 05:30
    expect(dateTimeInJst("2026-09-22T20:30:00.000Z")).toBe("2026/9/23 05:30");
    expect(timeInJst("2026-09-22T20:30:00.000Z")).toBe("05:30");
  });

  it("日付つきの書き方は YYYY/M/D HH:MM の1つだけで、コードと見間違える8桁の数字にならない（基準 26.17）", () => {
    const shown = dateTimeInJst("2026-09-20T10:30:00.000Z");
    expect(shown).toBe("2026/9/20 19:30");
    expect(shown).not.toMatch(/\d{8}/);
  });

  it("読めない値は空文字（表示を止めない）", () => {
    for (const bad of ["", "きのう", "2026-13-45T99:99:99Z"]) {
      expect(timeInJst(bad), bad).toBe("");
      expect(dateTimeInJst(bad), bad).toBe("");
    }
  });
});
