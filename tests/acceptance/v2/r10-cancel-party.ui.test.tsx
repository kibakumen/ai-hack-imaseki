// @vitest-environment jsdom
// 要件10（画面）: 10.5・10.7・10.8 の断りの表示。10.1・10.4 の操作が確保中の表示に在る。
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { componentOf, homeFetch, installFakeApi, invalidInput, refusal, reservationDto, type FakeApi } from "./_fakes";
import { TID } from "./_types";

describeTask("15", "確保中の表示の取り消しと人数の変更", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
  });

  const renderActive = async (routes: Record<string, any>) => {
    const reservation = reservationDto({ party: 2 });
    api = installFakeApi({ "GET /api/config/public": () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } }), "GET /api/customer/home": () => ({ json: { ...homeFetch(), kind: "active", reservation } }), ...routes });
    const CustomerApp = await componentOf("components/customer/CustomerApp", "CustomerApp");
    render(<CustomerApp />);
    return screen.findByTestId(TID.view("active"));
  };

  it("10.1・10.4 取り消す操作と人数を変える操作が在り、取り消しは確かめのあと要求が出て取得の画面へ戻る", async () => {
    const view = await renderActive({ "POST /api/customer/reservations/:id/cancel": () => ({ json: { ok: true, home: homeFetch() } }) });
    expect(within(view).getByTestId(TID.field("party"))).toBeTruthy();
    fireEvent.click(within(view).getByTestId(TID.btn("cancel")));
    expect(api.calls.filter((c) => c.path.endsWith("/cancel"))).toHaveLength(0);
    fireEvent.click(within(await screen.findByTestId("confirm-cancel")).getByTestId(TID.btn("confirm")));
    await screen.findByTestId(TID.btn("fetch"));
    expect(api.calls.filter((c) => c.path.endsWith("/cancel"))).toHaveLength(1);
  });

  it("10.5 party out_of_range は人数の欄の直下、10.7 party_over_max は操作の直下に出て、表示の人数は元のまま、確保中の表示のまま。10.8 取り消して探し直す手が出る。通ると人数が変わり文が無い", async () => {
    let response: any = invalidInput([{ name: "party", reason: "out_of_range" }]);
    const view = await renderActive({ "POST /api/customer/reservations/:id/party": () => response });
    const form = within(view).getByTestId(TID.form("party"));
    fireEvent.change(within(form).getByTestId(TID.field("party")), { target: { value: "11" } });
    fireEvent.click(within(form).getByTestId(TID.btn("change-party")));
    await waitFor(() => expect(within(form).getByTestId(TID.msg("party"))).toBeTruthy());
    expect(within(form).queryByTestId(TID.msgForm)).toBeNull();
    expect(within(view).getByTestId("reservation-party").textContent).toMatch(/2\s*名/);
    response = refusal("party_over_max", { partyMax: 4 });
    fireEvent.change(within(form).getByTestId(TID.field("party")), { target: { value: "5" } });
    fireEvent.click(within(form).getByTestId(TID.btn("change-party")));
    await waitFor(() => expect(within(form).getByTestId(TID.msgForm)).toBeTruthy());
    await waitFor(() => expect(within(form).queryByTestId(TID.msg("party"))).toBeNull());
    expect(within(form).getByTestId(TID.msgForm).textContent).toMatch(/受け入れ|取り消し/);
    expect(within(form).getByTestId(TID.msgForm).textContent).toMatch(/探し直/);
    expect(within(view).getByTestId("reservation-party").textContent).toMatch(/2\s*名/);
    expect(screen.getByTestId(TID.view("active"))).toBeTruthy();
    response = { json: { ok: true, home: { ...homeFetch(), kind: "active", reservation: reservationDto({ party: 3 }) } } };
    fireEvent.change(within(form).getByTestId(TID.field("party")), { target: { value: "3" } });
    fireEvent.click(within(form).getByTestId(TID.btn("change-party")));
    await waitFor(() => expect(within(view).getByTestId("reservation-party").textContent).toMatch(/3\s*名/));
    expect(within(form).queryByTestId(TID.msgForm)).toBeNull();
    expect(within(form).queryByTestId(TID.msg("party"))).toBeNull();
  });
});
