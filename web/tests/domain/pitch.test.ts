// 紹介文の決定論のガード（domain/pitch）。AI を呼ばずに、返ってきた文字列だけを見る。
import { describe, expect, it } from "vitest";
import { checkPitch, fallbackPitch, PITCH_CHAR_LIMIT, readJudgement } from "../../lib/domain/pitch";

const STORE = { name: "海鮮どんぶり亭", genres: ["和食"], menus: ["刺身盛り", "焼き魚定食"], walkMinutes: 3, budgetMin: 2000, budgetMax: 4000, couponName: "生ビール1杯", couponNote: "1組1回" };

describe("紹介文のガード（決定論）", () => {
  it("素直な1文は通り、前後の空白と丸ごとの囲いの引用符だけが外れる", () => {
    expect(checkPitch("  歩いて4分、今日は刺身盛りを出してるよ  ")).toEqual({ ok: true, text: "歩いて4分、今日は刺身盛りを出してるよ" });
    expect(checkPitch("「歩いて4分、今日は刺身盛りを出してるよ」")).toEqual({ ok: true, text: "歩いて4分、今日は刺身盛りを出してるよ" });
    // 対になっていない囲いは触らない（片側だけ削ると文が壊れる）
    expect(checkPitch("「刺身」と「焼き魚」が揃います")).toEqual({ ok: true, text: "「刺身」と「焼き魚」が揃います" });
  });

  it("存在しないデータ（口コミ・レビュー・評価・星）に触れた文は落ち、訳が付く", () => {
    for (const text of ["口コミでも人気です", "レビューが高い店です", "星4つの実力です", "クチコミ多数です"]) {
      const checked = checkPitch(text);
      expect(checked.ok, text).toBe(false);
      expect(checked.ok === false && checked.critique.length, text).toBeGreaterThan(0);
    }
  });

  it("空文・字数超え・URL・電話番号は落ちる", () => {
    expect(checkPitch("   ").ok).toBe(false);
    expect(checkPitch("あ".repeat(PITCH_CHAR_LIMIT)).ok).toBe(true);
    expect(checkPitch("あ".repeat(PITCH_CHAR_LIMIT + 1)).ok).toBe(false);
    expect(checkPitch("詳しくは https://example.com へ").ok).toBe(false);
    expect(checkPitch("予約は 03-1234-5678 まで").ok).toBe(false);
  });

  it("検査官の答えを読む（コードフェンスつきも読む・壊れていれば null）", () => {
    expect(readJudgement('{"ok":true,"reason":""}')).toEqual({ ok: true, critique: null });
    expect(readJudgement('```json\n{"ok":false,"reason":"星の数に触れている"}\n```')).toEqual({ ok: false, critique: "星の数に触れている" });
    expect(readJudgement('{"ok":false,"reason":""}')).toEqual({ ok: false, critique: null });
    expect(readJudgement("これは JSON ではない")).toBeNull();
    expect(readJudgement('{"reason":"x"}')).toBeNull();
  });

  it("諦めるときの文は AI を呼ばずに決まる（選定の理由 → クーポン → メニュー → 最後の1文）", () => {
    expect(fallbackPitch(STORE, "近くて好みに合います")).toBe("近くて好みに合います");
    expect(fallbackPitch(STORE, "")).toBe("生ビール1杯が使えます");
    expect(fallbackPitch({ ...STORE, couponName: null }, "")).toBe("おすすめは刺身盛り");
    expect(fallbackPitch({ ...STORE, couponName: null, menus: [] }, "").length).toBeGreaterThan(0);
  });
});
