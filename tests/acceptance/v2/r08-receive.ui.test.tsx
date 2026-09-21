// @vitest-environment jsdom
// 要件8（画面）: 8.5 受け取りのあと確保中の表示へ、8.10 確保中の客の結果、8.6 断りの表示（RefusalNotice・ResultList）。
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { componentOf, homeFetch, installFakeApi, loadWeb, reservationDto, type FakeApi } from "./_fakes";
import { TID, type HomeDto, type ResultItem } from "./_types";

const item = (over: Partial<ResultItem> = {}): ResultItem => ({ offerId: "o1", storeId: "s1", storeName: "店A", walkMinutes: 3, budgetMin: 2000, budgetMax: 4000, reason: "合います", partyMax: 4, coupons: [], storeUrl: null, ...over });
const installGeo = () => Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (ok: (p: any) => void) => ok({ coords: { latitude: 35.6, longitude: 139.7 } }) } });
const publicConfig = () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } });

describeTask("14", "受け取りの画面と断りの表示", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
  });

  const renderAndSearch = async (home: () => HomeDto, items: ResultItem[], reservations: (body: any) => any) => {
    installGeo();
    api = installFakeApi({ "GET /api/config/public": publicConfig, "GET /api/customer/home": () => ({ json: home() }), "POST /api/customer/fetch": () => ({ json: { ok: true, fetchId: "f1", items } }), "POST /api/customer/reservations": ({ body }) => reservations(body) });
    const CustomerApp = await componentOf("components/customer/CustomerApp", "CustomerApp");
    render(<CustomerApp />);
    await screen.findByTestId(TID.btn("fetch"));
    fireEvent.change(screen.getByTestId(TID.field("party")), { target: { value: "2" } });
    fireEvent.click(screen.getByTestId(TID.btn("fetch")));
    await screen.findByTestId(TID.card(items[0].offerId));
  };

  it("8.5 受け取りが通ると、確保したことを示して確保中の表示へ移る（応答の home で作り直す）", async () => {
    await renderAndSearch(homeFetch, [item()], (body) => {
      expect(body).toMatchObject({ offerId: "o1", party: 2, fetchId: "f1" });
      const reservation = reservationDto({ code: "87654321" });
      return { json: { ok: true, reservation, home: { ...homeFetch(), kind: "active", reservation } } };
    });
    fireEvent.click(within(screen.getByTestId(TID.card("o1"))).getByTestId(TID.btn("receive")));
    const view = await screen.findByTestId(TID.view("active"));
    expect(view.textContent).toContain("87654321");
    expect(screen.queryByTestId(TID.card("o1"))).toBeNull();
  });

  it("8.10 確保中の確保を持つ客の結果は受け取りの操作が選べず、取り消すと受け取れることが出る", async () => {
    const reservation = reservationDto();
    installGeo();
    api = installFakeApi({ "GET /api/config/public": publicConfig, "GET /api/customer/home": () => ({ json: { ...homeFetch(), kind: "active", reservation } }), "POST /api/customer/fetch": () => ({ json: { ok: true, fetchId: "f1", items: [item()] } }) });
    const CustomerApp = await componentOf("components/customer/CustomerApp", "CustomerApp");
    render(<CustomerApp />);
    await screen.findByTestId(TID.view("active"));
    fireEvent.click(screen.getByTestId(TID.btn("search-more")));
    await screen.findByTestId(TID.btn("fetch"));
    fireEvent.change(screen.getByTestId(TID.field("party")), { target: { value: "2" } });
    fireEvent.click(screen.getByTestId(TID.btn("fetch")));
    const card = await screen.findByTestId(TID.card("o1"));
    expect((within(card).getByTestId(TID.btn("receive")) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("result-list").textContent).toMatch(/取り消す/);
  });

  it("8.6 5種の断りで、押したカードの中に断りが出て、ほかのカードは残り、「何名まで」が応答の値に直り、次の一手を押すと取得の画面（人数つき）へ行く。ホームが確保中なら確保中の表示に切り替わる", async () => {
    const { TEXTS } = await loadWeb("lib/domain/texts");
    let refusal: any = { kind: "sold_out", nextStep: "search_again" };
    let home: HomeDto = homeFetch();
    await renderAndSearch(() => home, [item(), item({ offerId: "o2", storeId: "s2", storeName: "店B", partyMax: 6 })], () => ({ status: 409, json: { ok: false, refusal, home } }));
    const cases: Array<{ refusal: any; text: string }> = [
      { refusal: { kind: "sold_out", nextStep: "search_again" }, text: TEXTS.receiveRefusal("sold_out") },
      { refusal: { kind: "offer_ended", nextStep: "search_again" }, text: TEXTS.receiveRefusal("offer_ended") },
      { refusal: { kind: "store_banned", nextStep: "search_again" }, text: TEXTS.receiveRefusal("store_banned") },
      { refusal: { kind: "party_over_max", partyMax: 1, nextStep: "search_again_with_party" }, text: TEXTS.receiveRefusal("party_over_max", { partyMax: 1 }) },
    ];
    for (const cs of cases) {
      refusal = cs.refusal;
      const card = screen.getByTestId(TID.card("o1"));
      fireEvent.click(within(card).getByTestId(TID.btn("receive")));
      await waitFor(() => expect(within(card).getByTestId("refusal-notice").textContent).toContain(cs.text));
      expect(screen.getByTestId(TID.card("o2"))).toBeTruthy();
      expect(within(screen.getByTestId(TID.card("o2"))).queryByTestId("refusal-notice")).toBeNull();
      for (const w of ["不正", "誤り", "無効", "あなたの"]) expect(within(card).getByTestId("refusal-notice").textContent).not.toContain(w);
      expect(within(card).getAllByTestId(TID.btn("next-step"))).toHaveLength(1);
    }
    expect(screen.getByTestId(TID.card("o1")).textContent).toMatch(/1\s*名/);
    fireEvent.click(within(screen.getByTestId(TID.card("o1"))).getByTestId(TID.btn("next-step")));
    await screen.findByTestId(TID.btn("fetch"));
    expect((screen.getByTestId(TID.field("party")) as HTMLInputElement).value).toBe("1");
    expect(screen.queryByTestId(TID.card("o1"))).toBeNull();

    fireEvent.click(screen.getByTestId(TID.btn("fetch")));
    await screen.findByTestId(TID.card("o1"));
    const reservation = reservationDto();
    home = { ...homeFetch(), kind: "active", reservation };
    refusal = { kind: "has_active_reservation", nextStep: "back_to_reservation" };
    fireEvent.click(within(screen.getByTestId(TID.card("o1"))).getByTestId(TID.btn("receive")));
    await screen.findByTestId(TID.view("active"));
  });

  it("RefusalNotice は nextStep を自分で決めない（同じ kind でも渡した nextStep が違えば違うボタンが出る）", async () => {
    const { TEXTS } = await loadWeb("lib/domain/texts");
    const RefusalNotice = await componentOf("components/customer/RefusalNotice", "RefusalNotice");
    const a = render(<RefusalNotice refusal={{ kind: "sold_out", nextStep: "search_again" }} onNextStep={() => {}} />);
    const textA = within(a.container).getByTestId(TID.btn("next-step")).textContent;
    expect(textA).toBe(TEXTS.nextStep("search_again"));
    cleanup();
    const b = render(<RefusalNotice refusal={{ kind: "sold_out", nextStep: "retry_same_party" }} onNextStep={() => {}} />);
    const textB = within(b.container).getByTestId(TID.btn("next-step")).textContent;
    expect(textB).toBe(TEXTS.nextStep("retry_same_party"));
    expect(textA).not.toBe(textB);
    cleanup();
    const c = render(<RefusalNotice refusal={{ kind: "party_over_max", partyMax: 3, nextStep: "search_again_with_party" }} onNextStep={() => {}} />);
    expect(within(c.container).getByTestId(TID.btn("next-step")).textContent).toContain("3");
    expect(c.container.textContent).toContain(TEXTS.receiveRefusal("party_over_max", { partyMax: 3 }));
  });
});
