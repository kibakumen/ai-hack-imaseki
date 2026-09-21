// @vitest-environment jsdom
// 要件11（画面）: 11.5〜11.9 期限切れの表示、受け取り直しの断り（RefusalNotice を ExpiredView が使う）。
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { componentOf, homeFetch, installFakeApi, loadWeb, reservationDto, type FakeApi } from "./_fakes";
import { TID, type HomeDto } from "./_types";

const expiredHome = (over: Partial<HomeDto> = {}, expired: HomeDto["expired"] = { showCode: true, canRetry: true }): HomeDto => ({ ...homeFetch(), kind: "expired", reservation: reservationDto({ status: "expired", party: 2 }), expired, ...over });

describeTask("16", "期限切れの表示", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
  });

  const renderHome = async (home: () => HomeDto, routes: Record<string, any> = {}) => {
    api = installFakeApi({ "GET /api/config/public": () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } }), "GET /api/customer/home": () => ({ json: home() }), ...routes });
    const CustomerApp = await componentOf("components/customer/CustomerApp", "CustomerApp");
    render(<CustomerApp />);
    return screen.findByTestId(TID.view("expired"));
  };

  it("11.5・11.6・11.7・11.8 20分の内: 期限が切れたこと・コード・店名・人数・店の人に見せる案内・同じ人数で受け取り直す操作", async () => {
    const view = await renderHome(() => expiredHome());
    expect(view.textContent).toMatch(/期限/);
    expect(view.textContent).toContain("12345678");
    expect(view.textContent).toContain("受け取りの店");
    expect(view.textContent).toMatch(/2\s*名/);
    expect(view.textContent).toMatch(/店の人に|見せて/);
    expect(within(view).getByTestId(TID.btn("retry"))).toBeTruthy();
    expect(within(view).queryByTestId(TID.btn("search-again"))).toBeNull();
  });

  it("11.9 受け取り直せないなら、取得し直す入口が出て、受け取り直す操作が無い。11.6 20分を過ぎるとコードと案内が消える", async () => {
    let view = await renderHome(() => expiredHome({}, { showCode: true, canRetry: false }));
    expect(within(view).queryByTestId(TID.btn("retry"))).toBeNull();
    expect(within(view).getByTestId(TID.btn("search-again"))).toBeTruthy();
    cleanup();
    api.restore();
    view = await renderHome(() => expiredHome({ reservation: reservationDto({ status: "expired", code: "" }) }, { showCode: false, canRetry: false }));
    expect(view.textContent).not.toContain("12345678");
    expect(view.textContent).not.toMatch(/店の人に|見せて/);
    expect(within(view).getByTestId(TID.btn("search-again"))).toBeTruthy();
  });

  it("受け取り直しが断られたとき、操作の場所に RefusalNotice が出て、コード・店名・人数はそのまま、表示は応答のホームで作り直される", async () => {
    const { TEXTS } = await loadWeb("lib/domain/texts");
    let home: HomeDto = expiredHome();
    let refusal: any = { kind: "sold_out", nextStep: "search_again" };
    const view = await renderHome(() => home, { "POST /api/customer/reservations": ({ body }) => {
      expect(body).toEqual({ retryOf: "res-1" });
      return { status: 409, json: { ok: false, refusal, home } };
    } });
    home = expiredHome({}, { showCode: true, canRetry: false });
    fireEvent.click(within(view).getByTestId(TID.btn("retry")));
    await waitFor(() => expect(screen.getByTestId("refusal-notice").textContent).toContain(TEXTS.receiveRefusal("sold_out")));
    expect(screen.getByTestId(TID.view("expired")).textContent).toContain("12345678");
    expect(screen.getByTestId(TID.view("expired")).textContent).toContain("受け取りの店");
    expect(screen.getByTestId(TID.btn("next-step")).textContent).toBe(TEXTS.nextStep("search_again"));
    expect(screen.queryByTestId(TID.btn("retry"))).toBeNull();

    cleanup();
    api.restore();
    home = expiredHome();
    refusal = { kind: "party_over_max", partyMax: 1, nextStep: "search_again_with_party" };
    const view2 = await renderHome(() => home, { "POST /api/customer/reservations": () => ({ status: 409, json: { ok: false, refusal, home } }) });
    home = expiredHome({}, { showCode: true, canRetry: false, partyMax: 1 });
    fireEvent.click(within(view2).getByTestId(TID.btn("retry")));
    await waitFor(() => expect(screen.getByTestId(TID.btn("next-step")).textContent).toBe(TEXTS.nextStep("search_again_with_party", { partyMax: 1 })));

    cleanup();
    api.restore();
    home = expiredHome();
    refusal = { kind: "sold_out", nextStep: "retry_same_party" };
    const view3 = await renderHome(() => home, { "POST /api/customer/reservations": () => ({ status: 409, json: { ok: false, refusal, home } }) });
    fireEvent.click(within(view3).getByTestId(TID.btn("retry")));
    await waitFor(() => expect(screen.getByTestId(TID.btn("next-step")).textContent).toBe(TEXTS.nextStep("retry_same_party")));

    cleanup();
    api.restore();
    home = expiredHome();
    const completed: HomeDto = { ...homeFetch(), kind: "completed", reservation: reservationDto({ status: "completed" }) };
    const view4 = await renderHome(() => home, { "POST /api/customer/reservations": () => ({ status: 409, json: { ok: false, refusal: { kind: "offer_ended", nextStep: "search_again" }, home: completed } }) });
    fireEvent.click(within(view4).getByTestId(TID.btn("retry")));
    await screen.findByTestId(TID.view("completed"));
  });
});
