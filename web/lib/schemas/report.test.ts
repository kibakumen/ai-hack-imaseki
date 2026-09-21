// 通報の入力の形（要件26の基準 26.3）。空と空白だけは**ここでは通す**——断るのは手続きで、
// 理由の語を `required` にするため（schemas/report.ts の頭の注）。
import { describe, expect, it } from "vitest";
import { reportSchema } from "./report";
import { REPORT_REASON_MAX } from "./limits";

describe("reportSchema", () => {
  it("店の番号と理由が揃っていれば通る", () => {
    expect(reportSchema.safeParse({ storeId: "store-1", reason: "来たら閉まっていた" }).success).toBe(true);
  });

  it("500字は通り、501字は reason で落ちる（基準 26.3）", () => {
    expect(reportSchema.safeParse({ storeId: "s", reason: "あ".repeat(REPORT_REASON_MAX) }).success).toBe(true);
    const over = reportSchema.safeParse({ storeId: "s", reason: "あ".repeat(REPORT_REASON_MAX + 1) });
    expect(over.success).toBe(false);
    expect(over.error?.issues.map((i) => i.path[0])).toEqual(["reason"]);
  });

  it("空と空白だけは通す（断るのは手続き・基準 26.2）", () => {
    for (const reason of ["", "   ", "\n\t"]) expect(reportSchema.safeParse({ storeId: "s", reason }).success, JSON.stringify(reason)).toBe(true);
  });

  it("項目の欠け・型違いは落ちる（要件29の基準 29.2）", () => {
    expect(reportSchema.safeParse({}).success).toBe(false);
    expect(reportSchema.safeParse({ storeId: 9, reason: 3 }).success).toBe(false);
    expect(reportSchema.safeParse({ storeId: "", reason: "理由" }).success).toBe(false);
  });
});
