// @vitest-environment jsdom
// 要件28（画面・【最終日】）: 28.9 消した応答で端末に残した内容を消し、28.11 開き直すと登録の入力。28.5 の断りの表示。
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { componentOf, homeFetch, installFakeApi, refusal, reservationDto, type FakeApi } from "./_fakes";
import { TID } from "./_types";

describeTask("32", "登録の消去（画面）", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
    window.localStorage.clear();
  });

  it("28.9・28.11 消すと端末に残した内容が消え、登録の入力に戻る。28.5 断られると文が出て確保中の表示のまま", async () => {
    let deleted = false;
    let refuse = true;
    const reservation = reservationDto({ code: "77778888" });
    api = installFakeApi({
      "GET /api/config/public": () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } }),
      "GET /api/customer/home": () => (deleted ? { status: 401, json: { ok: false } } : { json: { ...homeFetch(), kind: "active", reservation } }),
      "DELETE /api/customer": () => {
        if (refuse) return refusal("has_active_reservation");
        deleted = true;
        return { json: { ok: true } };
      },
    });
    const CustomerApp = await componentOf("components/customer/CustomerApp", "CustomerApp");
    render(<CustomerApp />);
    await screen.findByTestId(TID.view("active"));
    await waitFor(() => expect(JSON.stringify(window.localStorage)).toContain("77778888"));
    fireEvent.click(screen.getByTestId(TID.btn("settings")));
    fireEvent.click(await screen.findByTestId(TID.btn("delete-account")));
    fireEvent.click(within(await screen.findByTestId("confirm-delete")).getByTestId(TID.btn("confirm")));
    await waitFor(() => expect(screen.getByTestId(TID.form("delete")).querySelector(`[data-testid="${TID.msgForm}"]`)!.textContent).toMatch(/取り消/));
    expect(screen.getByTestId(TID.view("active"))).toBeTruthy();
    refuse = false;
    fireEvent.click(screen.getByTestId(TID.btn("delete-account")));
    fireEvent.click(within(await screen.findByTestId("confirm-delete")).getByTestId(TID.btn("confirm")));
    await screen.findByTestId(TID.field("nickname"));
    expect(JSON.stringify(window.localStorage)).not.toContain("77778888");
    expect(screen.queryByTestId(TID.view("active"))).toBeNull();
  });
});
