// @vitest-environment jsdom
// 要件16（画面）: 16.2・16.3・16.5 の断りの表示、16.7 無い欄。
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { componentOf, installFakeApi, invalidInput, refusal, type FakeApi } from "./_fakes";
import { TID } from "./_types";

const COUPONS = [
  { id: "c1", name: "生ビール1杯", note: "1組1回", createdAt: "2026-09-01T00:00:00Z" },
  { id: "c2", name: "デザート", note: "", createdAt: "2026-09-02T00:00:00Z" },
];

describeTask("6", "クーポンの入力の画面", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
  });

  const setup = async (routes: Record<string, any>) => {
    api = installFakeApi({ "GET /api/store/coupons": () => ({ json: { items: COUPONS } }), ...routes });
    const CouponEditor = await componentOf("components/store/CouponEditor", "CouponEditor");
    const r = render(<CouponEditor />);
    await screen.findByText("生ビール1杯");
    return r;
  };

  it("16.7 人数・公開の設定・件数の欄が無い", async () => {
    const { container } = await setup({});
    expect(container.textContent).not.toMatch(/人数|公開設定|公開の設定|件数|枚数/);
    const names = [...container.querySelectorAll("[data-testid^='field-']")].map((e) => e.getAttribute("data-testid"));
    expect(names.every((n) => /^field-(name|note)/.test(n!))).toBe(true);
  });

  it("invalid_input（name・note）は欄の直下、limit_reached は「作る」の直下に出て、入れた名前と特記事項が残り、一覧は変わらない", async () => {
    let response: any = invalidInput([{ name: "name", reason: "too_long" }]);
    await setup({ "POST /api/store/coupons": () => response });
    fireEvent.change(screen.getByTestId(TID.field("name")), { target: { value: "あ".repeat(41) } });
    fireEvent.change(screen.getByTestId(TID.field("note")), { target: { value: "注意" } });
    fireEvent.click(screen.getByTestId(TID.btn("create-coupon")));
    await screen.findByTestId(TID.msg("name"));
    expect(screen.queryByTestId(TID.msg("note"))).toBeNull();
    response = invalidInput([{ name: "note", reason: "too_long" }]);
    fireEvent.click(screen.getByTestId(TID.btn("create-coupon")));
    await screen.findByTestId(TID.msg("note"));
    await waitFor(() => expect(screen.queryByTestId(TID.msg("name"))).toBeNull());
    response = refusal("limit_reached");
    fireEvent.click(screen.getByTestId(TID.btn("create-coupon")));
    await screen.findByTestId(TID.msgForm);
    expect(screen.getByTestId(TID.msgForm).textContent).toMatch(/3/);
    expect((screen.getByTestId(TID.field("name")) as HTMLInputElement).value).toBe("あ".repeat(41));
    expect((screen.getByTestId(TID.field("note")) as HTMLInputElement).value).toBe("注意");
    expect(screen.getAllByTestId(/^row-c/)).toHaveLength(2);
  });

  it("16.5 coupon_in_use は「削除」「保存する」の直下に出て、一覧は変わらない", async () => {
    await setup({ "DELETE /api/store/coupons/:id": () => refusal("coupon_in_use"), "PUT /api/store/coupons/:id": () => refusal("coupon_in_use") });
    const row = screen.getByTestId(TID.row("c1"));
    fireEvent.click(row.querySelector(`[data-testid="${TID.btn("delete-coupon")}"]`)!);
    await waitFor(() => expect(row.querySelector(`[data-testid="${TID.msgForm}"]`)!.textContent).toMatch(/公開を止め/));
    expect(screen.getAllByTestId(/^row-c/)).toHaveLength(2);
    expect(row.textContent).toContain("生ビール1杯");
  });
});
