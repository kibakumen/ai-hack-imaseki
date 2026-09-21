// 「公開中」の条件は SQL の文字列なので、型検査では守れない。契約で決まっている2点——
// 終わっていないこと・「今」を束縛した値で比べること——をここで固定する。
// （実行者への契約: SQL の比較も束縛した「今」で行う。SQLite の datetime('now') は使わない）
import { describe, expect, it } from "vitest";
import { publishingOfferCondition } from "./sqlFragments";

describe("公開中のオファーの条件", () => {
  const condition = publishingOfferCondition("o", "?2");

  it("終わっていないことと、「何時まで」がまだ先であることの両方を見る", () => {
    expect(condition).toContain("o.ended_at IS NULL");
    expect(condition).toContain("o.until_at > ?2");
    expect(condition).toContain("AND");
  });

  it("SQL の中の時計を使わない（渡された置き場所で比べる）", () => {
    expect(condition).not.toMatch(/datetime\s*\(|CURRENT_TIMESTAMP|julianday\s*\(\s*'now'/i);
  });

  it("表の別名と置き場所を変えても、同じ形が出る（使い回せる）", () => {
    expect(publishingOfferCondition("offers", "?1")).toBe("offers.ended_at IS NULL AND offers.until_at > ?1");
  });
});
