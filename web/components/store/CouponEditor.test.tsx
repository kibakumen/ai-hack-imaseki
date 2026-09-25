// @vitest-environment jsdom
// クーポンの編集の書きかけ（2026-09-25 監査の指摘 店-19）。
// それまでは保存・削除・作成が通るたびに全部の行の書きかけをサーバーの値で作り直していたので、A を直している途中で
// B を保存すると A の書きかけが黙って元に戻った。保存が通っても「保存しました」は出なかった。

import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { installFakeApi, invalidInput, type FakeApi, type FakeReply } from "../../../tests/acceptance/v2/_fakes";
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

/** 押してから答えが返るまでを、検査が開けるまで止めておく門。 */
const gate = () => {
  let open: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open: () => open() };
};

describe("クーポンの操作の断りと手応え（横断-03 のレビュー）", () => {
  it("「作る」で断られたあとに行の「保存する」を押しても、応答の前にその行へ前の断りが出ない", async () => {
    const hold = gate();
    const items = [{ id: "a", name: "生ビール1杯", note: "", createdAt: AT }];
    api = installFakeApi({
      "GET /api/store/coupons": () => ({ json: { ok: true, items } }),
      "POST /api/store/coupons": () => invalidInput([{ name: "name", reason: "required" }]),
      "PUT /api/store/coupons/:id": async (): Promise<FakeReply> => {
        await hold.wait;
        return { json: { ok: true, coupon: items[0] } };
      },
    });
    render(<CouponEditor />);
    await screen.findByTestId("row-a");
    fireEvent.click(screen.getByTestId("btn-create-coupon"));
    await within(screen.getByTestId("form-coupon")).findByTestId("msg-name");

    fireEvent.click(within(screen.getByTestId("row-a")).getByTestId("btn-save-coupon"));
    await waitFor(() => expect(within(screen.getByTestId("row-a")).getByTestId("btn-save-coupon").getAttribute("aria-busy")).toBe("true"));
    expect(within(screen.getByTestId("row-a")).queryByTestId("msg-name")).toBeNull();
    expect(nameField("a").getAttribute("aria-invalid")).toBeNull();
    expect(screen.queryAllByRole("alert")).toHaveLength(0);

    await act(async () => hold.open());
    await within(screen.getByTestId("row-a")).findByTestId("msg-saved");
  });

  it("通ったあとの取り直しが返るまでは、どのボタンも止めたままにする（押せる見た目で黙って無視しない）", async () => {
    const reloading = gate();
    let gets = 0;
    const items = [{ id: "a", name: "生ビール1杯", note: "", createdAt: AT }];
    api = installFakeApi({
      "GET /api/store/coupons": async (): Promise<FakeReply> => {
        gets += 1;
        if (gets > 1) await reloading.wait;
        return { json: { ok: true, items } };
      },
      "PUT /api/store/coupons/:id": () => ({ json: { ok: true, coupon: items[0] } }),
    });
    render(<CouponEditor />);
    await screen.findByTestId("row-a");
    fireEvent.click(within(screen.getByTestId("row-a")).getByTestId("btn-save-coupon"));
    await waitFor(() => expect(gets).toBe(2));

    const row = within(screen.getByTestId("row-a"));
    expect((row.getByTestId("btn-save-coupon") as HTMLButtonElement).disabled).toBe(true);
    expect((row.getByTestId("btn-delete-coupon") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("btn-create-coupon") as HTMLButtonElement).disabled).toBe(true);

    await act(async () => reloading.open());
    await waitFor(() => expect((within(screen.getByTestId("row-a")).getByTestId("btn-save-coupon") as HTMLButtonElement).disabled).toBe(false));
    expect((screen.getByTestId("btn-create-coupon") as HTMLButtonElement).disabled).toBe(false);
  });
});
