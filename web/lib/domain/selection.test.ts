// AI の出力の検査（要件7の基準 7.3・7.4）のうち、受け入れ検査が見ない道を固定する。
// 受け入れ検査（r07）は ok の真偽だけを見るので、落ちた訳の語（記録の validation_failed に
// 添えるもの）と、壊れた形・コードフェンスの書き方の揺れはここで縛る。
import { describe, expect, it } from "vitest";
import { fallbackResult, validateSelection } from "./selection";
import { TEXTS } from "./texts";

const IDS = ["s1", "s2", "s3", "s4", "s5", "s6"];
const body = (items: Array<{ storeId: string; reason: string }>) => JSON.stringify({ selections: items });
const rejectionOf = (text: string) => {
  const result = validateSelection(text, IDS);
  return result.ok ? null : result.rejection;
};

describe("AI の出力の検査", () => {
  it("落ちた訳が、場合ごとに違う語で返る", () => {
    expect(rejectionOf("これは JSON ではない")).toBe("not_json");
    expect(rejectionOf(JSON.stringify({ items: [] }))).toBe("bad_shape");
    expect(rejectionOf(body([{ storeId: "unknown", reason: "近いです" }]))).toBe("unknown_store");
    expect(rejectionOf(body(IDS.map((storeId) => ({ storeId, reason: "近いです" }))))).toBe("too_many");
    expect(rejectionOf(body([{ storeId: "s1", reason: "近い" }, { storeId: "s1", reason: "安い" }]))).toBe("duplicate_store");
    expect(rejectionOf(body([{ storeId: "s1", reason: " " }]))).toBe("empty_reason");
    expect(rejectionOf(body([{ storeId: "s1", reason: "あ".repeat(61) }]))).toBe("reason_too_long");
    expect(rejectionOf(body([{ storeId: "s1", reason: "近いです。安いです。" }]))).toBe("reason_multi_sentence");
    expect(rejectionOf(body([{ storeId: "s1", reason: "近い\n安い" }]))).toBe("reason_has_newline");
  });

  it("店の番号が文字列でない・選定の1件が値でない出力は、形が違うものとして落ちる", () => {
    expect(rejectionOf(JSON.stringify({ selections: [{ storeId: 1, reason: "近いです" }] }))).toBe("bad_shape");
    expect(rejectionOf(JSON.stringify({ selections: [null] }))).toBe("bad_shape");
    expect(rejectionOf(JSON.stringify({ selections: [{ storeId: "", reason: "近いです" }] }))).toBe("bad_shape");
    expect(rejectionOf("42")).toBe("bad_shape");
    expect(rejectionOf("null")).toBe("bad_shape");
  });

  it("コードフェンスは、言語の名前の有無・前後の空白に関わらず外れる", () => {
    const text = body([{ storeId: "s1", reason: "近いです" }]);
    for (const wrapped of [`\`\`\`json\n${text}\n\`\`\``, `\`\`\`\n${text}\n\`\`\``, `  \`\`\`JSON\n${text}\n\`\`\`  `]) {
      expect(validateSelection(wrapped, IDS).ok, wrapped).toBe(true);
    }
  });

  it("理由は前後の空白を落として返る。終わりの印が末尾に1つだけなら1文として通る", () => {
    const result = validateSelection(body([{ storeId: "s1", reason: "  近くて安いです。  " }]), IDS);
    expect(result).toEqual({ ok: true, items: [{ storeId: "s1", reason: "近くて安いです。" }] });
    expect(validateSelection(body([{ storeId: "s2", reason: "刺身が名物です！" }]), IDS).ok).toBe(true);
    expect(validateSelection(body([{ storeId: "s2", reason: "予算3.000円で入れます" }]), IDS).ok).toBe(true);
  });
});

describe("点数順への倒し方", () => {
  it("上位5件までに決まった文が入り、渡された配列は書き換わらない", () => {
    const ranked = [...IDS];
    const fallback = fallbackResult(ranked);
    expect(fallback).toHaveLength(5);
    expect(fallback.map((item) => item.storeId)).toEqual(IDS.slice(0, 5));
    expect(new Set(fallback.map((item) => item.reason))).toEqual(new Set([TEXTS.fallbackReason]));
    expect(ranked).toEqual(IDS);
  });
});
