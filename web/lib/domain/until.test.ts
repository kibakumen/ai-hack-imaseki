// 「何時まで」の解釈（設計書「「何時まで」の入力と解釈」の表）。
// 起点 T0 = 2026-09-22 15:00 JST。枠は公開から12時間＝翌 03:00 まで。

import { describe, expect, it } from "vitest";
import { formatTimeOfDay, latestUntilOf, parseTimeOfDay, resolveUntil } from "./until";

const jst = (hhmm: string, dayOffset = 0): Date => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 8, 22 + dayOffset, h - 9, m));
};

describe("parseTimeOfDay", () => {
  it("形が合えば分に直し、合わなければ null", () => {
    expect(parseTimeOfDay("00:00")).toBe(0);
    expect(parseTimeOfDay("15:30")).toBe(15 * 60 + 30);
    expect(parseTimeOfDay("23:59")).toBe(23 * 60 + 59);
    for (const bad of ["24:00", "9:00", "15:60", "", "15時", "15:0a"]) expect(parseTimeOfDay(bad), bad).toBeNull();
  });
});

describe("formatTimeOfDay", () => {
  it("日本時間の時分にする（日付をまたぐ時刻も）", () => {
    expect(formatTimeOfDay(jst("22:30"))).toBe("22:30");
    expect(formatTimeOfDay(jst("02:00", 1))).toBe("02:00");
    expect(formatTimeOfDay(jst("00:00"))).toBe("00:00");
  });
});

describe("latestUntilOf", () => {
  it("公開した時刻（分の頭）から12時間", () => {
    expect(latestUntilOf(jst("15:00")).toISOString()).toBe(jst("03:00", 1).toISOString());
    expect(latestUntilOf(new Date(jst("15:00").getTime() + 45_000)).toISOString()).toBe(jst("03:00", 1).toISOString());
  });
});

describe("resolveUntil（公開のとき: 起点＝今）", () => {
  const now = jst("15:00");
  const at = (input: string) => resolveUntil({ input, publishedAt: now, now });

  it("17.6 今の時分（起点そのもの）は今以前", () => {
    expect(at("15:00")!.kind).toBe("in_past");
  });

  it("17.5 今より後で12時間以内は通る（日付をまたぐ時刻も）", () => {
    expect(at("15:01")!.kind).toBe("ok");
    expect(at("22:30")!.at.toISOString()).toBe(jst("22:30").toISOString());
    expect(at("02:00")!.at.toISOString()).toBe(jst("02:00", 1).toISOString());
    // 枠のちょうど端は通る
    expect(at("03:00")!.kind).toBe("ok");
  });

  it("17.6 枠の外（12時間＋1分・公開の時分より前の時分）は over_window", () => {
    expect(at("03:01")!.kind).toBe("over_window");
    expect(at("14:59")!.kind).toBe("over_window");
  });

  it("どの場合も最長の時刻を返す", () => {
    for (const input of ["15:00", "22:30", "03:01"]) expect(at(input)!.latest.toISOString(), input).toBe(jst("03:00", 1).toISOString());
  });

  it("形が違えば null", () => {
    expect(at("25:00")).toBeNull();
  });
});

describe("resolveUntil（公開中の変更: 起点＝公開した時刻・要件19）", () => {
  // 公開 15:00・今 16:40（設計書 S5 の12歩目の裏側）
  const publishedAt = jst("15:00");
  const now = jst("16:40");
  const at = (input: string) => resolveUntil({ input, publishedAt, now })!;

  it("19.8 延ばすのも早めるのもできる", () => {
    expect(at("18:00").kind).toBe("ok");
    expect(at("16:50").kind).toBe("ok");
  });

  it("19.9 公開した時刻から今までの時分は今以前", () => {
    expect(at("16:00").kind).toBe("in_past");
    expect(at("15:00").kind).toBe("in_past");
  });

  it("19.13 枠の外（公開した時刻より前の時分は翌日と読む）", () => {
    expect(at("04:00").kind).toBe("over_window");
    expect(at("14:00").kind).toBe("over_window");
    expect(at("04:00").latest.toISOString()).toBe(jst("03:00", 1).toISOString());
  });

  it("公開 20:00・今 23:00 では 02:00 が通り 21:00 は今以前", () => {
    const published = jst("20:00");
    const current = jst("23:00");
    expect(resolveUntil({ input: "02:00", publishedAt: published, now: current })!.kind).toBe("ok");
    expect(resolveUntil({ input: "21:00", publishedAt: published, now: current })!.kind).toBe("in_past");
  });
});
