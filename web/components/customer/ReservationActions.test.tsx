// @vitest-environment jsdom
// 確保中の表示の2つの操作の振る舞い（要件10の基準 10.1・10.3・10.5・10.7・10.8）。
//
// ⚠️ **なぜ単体の検査を置いたか**（2026-09-21・タスク15）: 画面の受け入れ検査
// `r10-cancel-party.ui.test.tsx` は `CustomerApp` を描いて確保中の表示（`view-active`）の中から
// この2つの操作を引く。その確保中の表示を作るのは**タスク14**（`components/customer/ReservationView`）で、
// 並列の実装では未着手だった。そこで、この部品だけを直接描いて振る舞いを固定してある。
// タスク14 が入って `ReservationView` がこの部品を描けば、受け入れ検査の側も通る。

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReservationActions } from "./ReservationActions";

type FakeResponse = { status?: number; json: unknown };

/** この部品が呼ぶ入口だけの偽物。呼ばれた道筋と本文を控える。 */
const installFetch = (respond: (path: string) => FakeResponse) => {
  const calls: Array<{ path: string; body: unknown }> = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    calls.push({ path, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
    const out = respond(path);
    return new Response(JSON.stringify(out.json), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = previous; } };
};

const invalidParty = { status: 400, json: { ok: false, error: { kind: "invalid_input", fields: [{ name: "party", reason: "out_of_range" }] } } };
const partyOverMax = { status: 409, json: { ok: false, error: { kind: "party_over_max", partyMax: 4 } } };

describe("確保中の表示の2つの操作", () => {
  let fake: ReturnType<typeof installFetch> | null = null;

  afterEach(() => {
    cleanup();
    fake?.restore();
    fake = null;
  });

  const renderActions = (respond: (path: string) => FakeResponse) => {
    fake = installFetch(respond);
    const onChanged = vi.fn();
    render(<ReservationActions reservation={{ id: "res-1", party: 2 }} onChanged={onChanged} />);
    return onChanged;
  };

  it("10.1 取り消しは確かめのあとに1回だけ要求が出て、応答のホームがそのまま親へ渡る", async () => {
    const home = { kind: "fetch" };
    const onChanged = renderActions(() => ({ json: { ok: true, home } }));

    fireEvent.click(screen.getByTestId("btn-cancel"));
    expect(fake!.calls).toHaveLength(0);

    fireEvent.click(within(screen.getByTestId("confirm-cancel")).getByTestId("btn-confirm"));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(home));
    expect(fake!.calls.map((c) => c.path)).toEqual(["/api/customer/reservations/res-1/cancel"]);
  });

  it("10.1 確かめの「やめる」を押すと、要求は出ない", () => {
    renderActions(() => ({ json: { ok: true, home: {} } }));
    fireEvent.click(screen.getByTestId("btn-cancel"));
    fireEvent.click(screen.getByText("やめる"));
    expect(screen.queryByTestId("confirm-cancel")).toBeNull();
    expect(fake!.calls).toHaveLength(0);
  });

  it("10.3 確保中でなくなっていた断りでは、ホームを取り直させる（`home` を渡さずに呼ぶ）", async () => {
    const onChanged = renderActions(() => ({ status: 409, json: { ok: false, current: { state: "expired" } } }));
    fireEvent.click(screen.getByTestId("btn-cancel"));
    fireEvent.click(within(screen.getByTestId("confirm-cancel")).getByTestId("btn-confirm"));
    // 引数なしで呼ぶ＝親は応答のホームを使わず、自分で取り直す
    await waitFor(() => expect(onChanged.mock.calls).toEqual([[]]));
  });

  it("10.5 人数の範囲の誤りは欄の直下に出て、操作の直下には出ない。入れた値は残る", async () => {
    renderActions(() => invalidParty);
    const form = screen.getByTestId("form-party");
    fireEvent.change(within(form).getByTestId("field-party"), { target: { value: "11" } });
    fireEvent.click(within(form).getByTestId("btn-change-party"));

    await waitFor(() => expect(within(form).getByTestId("msg-party").textContent).toMatch(/1〜10/));
    expect(within(form).queryByTestId("msg-form")).toBeNull();
    expect((within(form).getByTestId("field-party") as HTMLInputElement).value).toBe("11");
  });

  it("10.7・10.8 「何名まで」を超える増やす変更は操作の直下に出て、取り消して探し直す手を示す", async () => {
    renderActions(() => partyOverMax);
    const form = screen.getByTestId("form-party");
    fireEvent.change(within(form).getByTestId("field-party"), { target: { value: "5" } });
    fireEvent.click(within(form).getByTestId("btn-change-party"));

    await waitFor(() => expect(within(form).getByTestId("msg-form")).toBeTruthy());
    expect(within(form).getByTestId("msg-form").textContent).toMatch(/受け入れ|取り消し/);
    expect(within(form).getByTestId("msg-form").textContent).toMatch(/探し直/);
    expect(within(form).queryByTestId("msg-party")).toBeNull();
  });

  it("10.4 通ると文が消え、応答のホームがそのまま親へ渡る", async () => {
    const home = { kind: "active", reservation: { party: 3 } };
    let response: FakeResponse = invalidParty;
    const onChanged = renderActions(() => response);
    const form = screen.getByTestId("form-party");

    fireEvent.click(within(form).getByTestId("btn-change-party"));
    await waitFor(() => expect(within(form).getByTestId("msg-party")).toBeTruthy());

    response = { json: { ok: true, home } };
    fireEvent.change(within(form).getByTestId("field-party"), { target: { value: "3" } });
    fireEvent.click(within(form).getByTestId("btn-change-party"));

    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(home));
    expect(within(form).queryByTestId("msg-party")).toBeNull();
    expect(within(form).queryByTestId("msg-form")).toBeNull();
    expect(fake!.calls.at(-1)).toEqual({ path: "/api/customer/reservations/res-1/party", body: { party: 3 } });
  });

  it("10.5 空欄は人数の項目を載せない（入口が「入れてください」と答えられるように）", async () => {
    renderActions(() => invalidParty);
    const form = screen.getByTestId("form-party");
    fireEvent.change(within(form).getByTestId("field-party"), { target: { value: "" } });
    fireEvent.click(within(form).getByTestId("btn-change-party"));
    await waitFor(() => expect(fake!.calls).toHaveLength(1));
    expect(fake!.calls[0].body).toEqual({});
  });
});
