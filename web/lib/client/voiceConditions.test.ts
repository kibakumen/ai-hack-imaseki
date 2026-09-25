// 声で入れた文から、人数・予算の上限・ジャンルを決まった規則で読み取る（2026-09-25 監査の指摘 客-16 の案A）。
// AI は使わない（要件7の基準 7.12: AI を呼ぶ場所は取得の手続きの1か所だけ）——読み取りは端末の中で済ませる。
import { describe, expect, it } from "vitest";
import { TEXTS } from "../domain/texts";
import { GENRE_KEYWORDS, parseSpokenConditions } from "./voiceConditions";

describe("声で入れた文の読み取り", () => {
  it("人数: 数字・漢数字・ひとり／ふたり・全角の数字を読む", () => {
    expect(parseSpokenConditions("4人で").party).toBe(4);
    expect(parseSpokenConditions("三名です").party).toBe(3);
    expect(parseSpokenConditions("ふたりで居酒屋").party).toBe(2);
    expect(parseSpokenConditions("ひとり").party).toBe(1);
    expect(parseSpokenConditions("１０人").party).toBe(10);
    expect(parseSpokenConditions("十人くらい").party).toBe(10);
    expect(parseSpokenConditions("居酒屋がいい").party).toBeUndefined();
  });

  it("予算: 円・千円・漢数字の千円を読み、「予算なし」は上限なし", () => {
    expect(parseSpokenConditions("予算は3000円まで").budgetMax).toBe(3000);
    expect(parseSpokenConditions("5,000円以内").budgetMax).toBe(5000);
    expect(parseSpokenConditions("3千円くらい").budgetMax).toBe(3000);
    expect(parseSpokenConditions("二千円で").budgetMax).toBe(2000);
    expect(parseSpokenConditions("予算なしで").budgetMax).toBeNull();
    expect(parseSpokenConditions("4人で").budgetMax).toBeUndefined();
  });

  it("ジャンル: 選択肢の名前と言い換えを読み、取り違えやすい語（ハンバーグ・駅のそば）では選ばない", () => {
    expect(parseSpokenConditions("焼き鳥か寿司").genres).toEqual(["寿司・海鮮", "焼き鳥・串"]);
    expect(parseSpokenConditions("パスタが食べたい").genres).toEqual(["イタリアン・洋食"]);
    expect(parseSpokenConditions("ハンバーグ").genres).toEqual([]);
    expect(parseSpokenConditions("駅のそばで").genres).toEqual([]);
    expect(parseSpokenConditions("お蕎麦").genres).toEqual(["そば・うどん"]);
    expect(parseSpokenConditions("カフェかバーで").genres).toEqual(["カフェ・バー"]);
  });

  it("まとめて: 「4人で居酒屋、予算3000円」", () => {
    expect(parseSpokenConditions("4人で居酒屋、予算3000円")).toEqual({ party: 4, budgetMax: 3000, genres: ["居酒屋"] });
  });

  it("選択肢のジャンルは全部、少なくとも1つの言い方で選べる（言い換えの表の漏れを見張る）", () => {
    for (const genre of TEXTS.genres) expect(GENRE_KEYWORDS[genre]?.length ?? 0, genre).toBeGreaterThan(0);
  });
});
