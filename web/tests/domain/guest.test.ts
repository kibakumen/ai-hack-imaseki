// 自動の登録の仮の値（仮の電話番号・`guest-…` の呼び名）の見分け（2026-09-25 監査の指摘 横断-02 とそのレビュー）。
//
// 見分けの正本は domain/guest.ts の1か所。ただし部品は lib/domain のうち texts.ts しか値として読めない
// （依存の向き）ので、部品が要る2つの定数は schemas/limits.ts に写しを置き、客の画面の電話番号の欄は
// その写しで見分ける。写しと部品の見分けが正本から黙ってずれないよう、ここで固定する
// （domain/genres.test.ts と同じ形。「写しを置くときは、一致を検査で固定する」）。
import { describe, expect, it } from "vitest";
import { phoneToShow, phoneToStore } from "../../components/customer/FetchForm";
import { guestNickname } from "../../components/customer/GuestEntry";
import { GUEST_NICKNAME_PREFIX, GUEST_PHONE_PLACEHOLDER, isGuestNickname, isPlaceholderPhone } from "../../lib/domain/guest";
import * as limits from "../../lib/schemas/limits";

describe("仮の値の見分け（domain/guest）", () => {
  it("仮の番号・空・無しは「番号が無い」。客が入れた番号はそうでない", () => {
    expect(isPlaceholderPhone(GUEST_PHONE_PLACEHOLDER)).toBe(true);
    expect(isPlaceholderPhone("")).toBe(true);
    expect(isPlaceholderPhone(null)).toBe(true);
    expect(isPlaceholderPhone(undefined)).toBe(true);
    expect(isPlaceholderPhone("09012345678")).toBe(false);
  });

  it("`guest-` で始まる呼び名・空・無しは「客が決めていない」。自分で入れた呼び名はそうでない", () => {
    expect(isGuestNickname(`${GUEST_NICKNAME_PREFIX}k3j9x2`)).toBe(true);
    expect(isGuestNickname("")).toBe(true);
    expect(isGuestNickname(null)).toBe(true);
    expect(isGuestNickname("guest好きのたなか")).toBe(false);
    expect(isGuestNickname("たなか")).toBe(false);
  });
});

describe("部品のための写し（schemas/limits）と部品の見分けが、正本と揃っている", () => {
  it("schemas/limits の2つの定数が、正本と同じ値", () => {
    expect(limits.GUEST_PHONE_PLACEHOLDER).toBe(GUEST_PHONE_PLACEHOLDER);
    expect(limits.GUEST_NICKNAME_PREFIX).toBe(GUEST_NICKNAME_PREFIX);
  });

  it("schemas/limits は判断の関数を持たない（定数だけ・設計書「依存の向き」の注）", () => {
    expect(Object.values(limits).filter((value) => typeof value === "function")).toEqual([]);
  });

  it("取得の画面の電話番号の欄は、正本が「番号が無い」とする値だけを空で見せ、それ以外はそのまま見せる", () => {
    for (const stored of [GUEST_PHONE_PLACEHOLDER, "", null, undefined, "09012345678", "0312345678"]) {
      expect(phoneToShow(stored) === "", String(stored)).toBe(isPlaceholderPhone(stored));
      if (!isPlaceholderPhone(stored)) expect(phoneToShow(stored)).toBe(stored);
    }
  });

  it("取得の画面の電話番号の欄を空にして保存すると、正本が「番号が無い」とする値になる", () => {
    expect(isPlaceholderPhone(phoneToStore(""))).toBe(true);
    expect(isPlaceholderPhone(phoneToStore("  "))).toBe(true);
    expect(phoneToStore(" 09012345678 ")).toBe("09012345678");
  });

  it("自動の登録が作る呼び名は、正本が「客が決めていない」とする形（店の一覧に名前として出ない）", () => {
    for (let i = 0; i < 20; i += 1) {
      const nickname = guestNickname();
      expect(isGuestNickname(nickname), nickname).toBe(true);
      expect(nickname.length).toBeLessThanOrEqual(limits.NICKNAME_MAX);
    }
  });
});
