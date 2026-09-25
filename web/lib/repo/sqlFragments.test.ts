// 「公開中」の条件は SQL の文字列なので、型検査では守れない。契約で決まっている2点——
// 終わっていないこと・「今」を束縛した値で比べること——をここで固定する。
// （実行者への契約: SQL の比較も束縛した「今」で行う。SQLite の datetime('now') は使わない）
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  activeReservationCondition,
  expiredReservationCondition,
  expiredWithinGraceCondition,
  holdsSlotCondition,
  publishingOfferCondition,
  receivableCondition,
  remainingExpression,
} from "./sqlFragments";

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

// タスク13が足した3つ（断片を1組へ寄せたときの確かめ。TS の側との突き合わせは受け入れ検査 r18）
describe("枠を押さえている確保・残り・受け取れる状態", () => {
  it("押さえているのは3つだけ（確保中で期限より前・完了済みで holds_slot=1・店が取り消した）", () => {
    const condition = holdsSlotCondition("res", "?1");
    expect(condition).toContain("res.status = 'active' AND res.expires_at > ?1");
    expect(condition).toContain("res.status = 'completed' AND res.holds_slot = 1");
    expect(condition).toContain("res.status = 'store_cancelled'");
  });

  it("残りは「募集する組数 − 押さえている数」で、確保の表を副問い合わせで数える", () => {
    const expression = remainingExpression("o", "?2");
    expect(expression).toContain("o.capacity -");
    expect(expression).toContain("SELECT COUNT(*) FROM reservations r");
    expect(expression).toContain("r.offer_id = o.id");
  });

  it("受け取れる状態は「公開中 かつ 残りが1以上」（domain/offer.isReceivable と同じ順）", () => {
    const condition = receivableCondition("o", "?1");
    expect(condition).toContain("o.ended_at IS NULL");
    expect(condition).toContain("o.until_at > ?1");
    expect(condition).toContain(">= 1");
  });

  it("どの断片も SQL の中の時計を使わない（渡された置き場所で比べる）", () => {
    for (const sql of [holdsSlotCondition("res", "?1"), remainingExpression("o", "?1"), receivableCondition("o", "?1")]) {
      expect(sql).not.toMatch(/datetime\s*\(|CURRENT_TIMESTAMP|julianday\s*\(\s*'now'/i);
    }
  });
});

// 2026-09-25 監査の指摘 設計-10: 「確保中」の条件が、ただ1つの置き場を名乗るこのファイルを通らずに5か所で手書きされていた。
describe("確保の状態の条件のただ1つの置き場", () => {
  it("確保中・期限切れ・期限から20分以内の期限切れは、束縛した「今」で切り分ける（期限ちょうどは期限切れ）", () => {
    expect(activeReservationCondition("res", "?2")).toBe("res.status = 'active' AND res.expires_at > ?2");
    expect(expiredReservationCondition("res", "?2")).toBe("res.status = 'active' AND res.expires_at <= ?2");
    expect(expiredWithinGraceCondition("res", "?2", "?3")).toBe("res.status = 'active' AND res.expires_at <= ?2 AND res.expires_at > ?3");
  });

  it("repo のほかのファイルに、確保の状態の条件（status = 'active' の比べ方）を手で書いていない", () => {
    const dir = path.dirname(new URL(import.meta.url).pathname);
    const code = (text: string) =>
      text
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join("\n");
    const offenders = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "sqlFragments.ts")
      .filter((name) => /status\s*=\s*'active'/.test(code(fs.readFileSync(path.join(dir, name), "utf8"))));
    expect(offenders).toEqual([]);
  });
});
