// ジャンルの選択肢は2か所に在る——判断の正本 domain/genres.ts と、画面に出す写し domain/texts.ts。
// 部品は lib/domain のうち texts.ts しか値として読めない（依存の向き）ので写しが要る。
// 写しが黙ってずれないよう、一致をここで固定する。
import { describe, expect, it } from "vitest";
import { GENRES } from "../../lib/domain/genres";
import { TEXTS } from "../../lib/domain/texts";

describe("ジャンルの選択肢", () => {
  it("12個あり、同じものが2度は入っていない（基準 1.4）", () => {
    expect(GENRES).toHaveLength(12);
    expect(new Set(GENRES).size).toBe(12);
  });

  it("画面に出す写し（TEXTS.genres）が、正本と同じ並びで同じ中身", () => {
    expect([...TEXTS.genres]).toEqual([...GENRES]);
  });
});
