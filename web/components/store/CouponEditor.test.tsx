// @vitest-environment jsdom
// クーポンの編集の書きかけ（2026-09-25 監査の指摘 店-19）。
// それまでは保存・削除・作成が通るたびに全部の行の書きかけをサーバーの値で作り直していたので、A を直している途中で
// B を保存すると A の書きかけが黙って元に戻った。保存が通っても「保存しました」は出なかった。

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { installFakeApi, type FakeApi } from "../../../tests/acceptance/v2/_fakes";
import { CouponEditor } from "./CouponEditor";

let api: FakeApi | null = null;

afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
});

type Coupon = { id: string; name: string; note: string; createdAt: string };
const AT = "2026-09-22T06:00:00.000Z";

const renderEditor = async (initial: Coupon[]) => {
  let items = initial;
  api = installFakeApi({
    "GET /api/store/coupons": () => ({ json: { ok: true, items } }),
    "PUT /api/store/coupons/:id": ({ path, body }: { path: string; body: { name: string; note: string } }) => {
      const id = path.split("/").pop()!;
      items = items.map((c) => (c.id === id ? { ...c, ...body } : c));
      return { json: { ok: true, coupon: items.find((c) => c.id === id) } };
    },
    "DELETE /api/store/coupons/:id": ({ path }: { path: string }) => {
      const id = path.split("/").pop()!;
      items = items.filter((c) => c.id !== id);
      return { json: { ok: true } };
    },
  });
  render(<CouponEditor />);
  await screen.findByTestId("row-a");
};

const nameField = (id: string) => screen.getByTestId(`field-name-${id}`) as HTMLInputElement;

describe("クーポンの書きかけ（店-19）", () => {
  it("B を保存しても、A の書きかけは消えない。B には「保存しました」が出る", async () => {
    await renderEditor([
      { id: "a", name: "生ビール1杯", note: "", createdAt: AT },
      { id: "b", name: "デザート", note: "", createdAt: AT },
    ]);
    fireEvent.change(nameField("a"), { target: { value: "生ビール2杯（書きかけ）" } });
    fireEvent.change(nameField("b"), { target: { value: "デザート盛り" } });
    fireEvent.click(within(screen.getByTestId("row-b")).getByTestId("btn-save-coupon"));
    await waitFor(() => expect(within(screen.getByTestId("row-b")).getByTestId("msg-saved").textContent).toMatch(/保存しました/));
    expect(nameField("a").value).toBe("生ビール2杯（書きかけ）");
    expect(nameField("b").value).toBe("デザート盛り");
    expect(within(screen.getByTestId("row-a")).queryByTestId("msg-saved")).toBeNull();
  });

  it("B を削除しても、A の書きかけは消えない", async () => {
    await renderEditor([
      { id: "a", name: "生ビール1杯", note: "", createdAt: AT },
      { id: "b", name: "デザート", note: "", createdAt: AT },
    ]);
    fireEvent.change(nameField("a"), { target: { value: "書きかけ" } });
    fireEvent.click(within(screen.getByTestId("row-b")).getByTestId("btn-delete-coupon"));
    fireEvent.click(screen.getByTestId("btn-confirm-delete-coupon"));
    await waitFor(() => expect(screen.queryByTestId("row-b")).toBeNull());
    expect(nameField("a").value).toBe("書きかけ");
  });

  it("保存したあとに同じ行を直し始めると「保存しました」は消える", async () => {
    await renderEditor([{ id: "a", name: "生ビール1杯", note: "", createdAt: AT }]);
    fireEvent.change(nameField("a"), { target: { value: "生ビール2杯" } });
    fireEvent.click(within(screen.getByTestId("row-a")).getByTestId("btn-save-coupon"));
    await screen.findByTestId("msg-saved");
    fireEvent.change(nameField("a"), { target: { value: "生ビール3杯" } });
    expect(screen.queryByTestId("msg-saved")).toBeNull();
  });
});
