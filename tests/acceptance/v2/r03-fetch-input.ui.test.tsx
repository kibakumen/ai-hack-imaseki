// @vitest-environment jsdom
// 要件3（画面）: 3.1・3.7・3.8 現在地、3.12・3.13 その回の好み、3.3〜3.7・3.11 の断りの表示。要件4 の 4.4・4.5・4.11・4.14 は r04 の ui。
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { describeTask } from "./_tasks";
import { componentOf, CUSTOMER, homeFetch, installFakeApi, invalidInput, loadWeb, refusal, type FakeApi } from "./_fakes";
import { TID } from "./_types";

const publicConfig = () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } });

type Geo = { mode: "ok" | "deny" | "hang"; coords?: { latitude: number; longitude: number } };
const installGeolocation = (geo: Geo) => {
  Object.defineProperty(navigator, "geolocation", {
    configurable: true,
    value: {
      getCurrentPosition: (ok: (p: any) => void, err: (e: any) => void) => {
        if (geo.mode === "ok") ok({ coords: geo.coords });
        else if (geo.mode === "deny") err({ code: 1, message: "denied" });
      },
    },
  });
};

describeTask("12", "取得の画面", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
    vi.useRealTimers();
  });

  const renderApp = async (routes: Record<string, any> = {}) => {
    api = installFakeApi({ "GET /api/config/public": publicConfig, "GET /api/customer/home": () => ({ json: homeFetch() }), "POST /api/customer/fetch": () => ({ json: { ok: true, fetchId: "f1", items: [] } }), ...routes });
    const CustomerApp = await componentOf("components/customer/CustomerApp", "CustomerApp");
    render(<CustomerApp />);
    await screen.findByTestId(TID.btn("fetch"));
  };
  const fetchCalls = () => api.calls.filter((c) => c.method === "POST" && c.path === "/api/customer/fetch");

  it("3.13・3.12 初めの値が登録の値で、変えた値が要求に載る", async () => {
    installGeolocation({ mode: "ok", coords: { latitude: 35.1, longitude: 139.1 } });
    await renderApp();
    const genres = screen.getByTestId(TID.field("genres"));
    for (const g of CUSTOMER.genres) expect((within(genres).getByTestId(`genre-${g}`) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId(TID.field("budgetMax")) as HTMLInputElement).value).toBe(String(CUSTOMER.budgetMax));
    fireEvent.click(within(genres).getByTestId(`genre-${CUSTOMER.genres[0]}`));
    fireEvent.click(within(genres).getByTestId("genre-中華"));
    fireEvent.change(screen.getByTestId(TID.field("budgetMax")), { target: { value: "1500" } });
    fireEvent.change(screen.getByTestId(TID.field("party")), { target: { value: "3" } });
    fireEvent.click(screen.getByTestId(TID.btn("fetch")));
    await waitFor(() => expect(fetchCalls()).toHaveLength(1));
    expect(fetchCalls()[0].body).toMatchObject({ party: 3, budgetMax: 1500, lat: 35.1, lng: 139.1 });
    expect([...fetchCalls()[0].body.genres].sort()).toEqual([CUSTOMER.genres[1], "中華"].sort());
    expect(fetchCalls()[0].body.place ?? null).toBeNull();
  });

  it("3.1・3.2 場所の文字が空なら現在地の座標で要求し、文字があれば座標を送らず文字を送る", async () => {
    installGeolocation({ mode: "ok", coords: { latitude: 35.2, longitude: 139.2 } });
    await renderApp();
    fireEvent.change(screen.getByTestId(TID.field("party")), { target: { value: "2" } });
    fireEvent.change(screen.getByTestId(TID.field("place")), { target: { value: "渋谷駅" } });
    fireEvent.click(screen.getByTestId(TID.btn("fetch")));
    await waitFor(() => expect(fetchCalls()).toHaveLength(1));
    expect(fetchCalls()[0].body.place).toBe("渋谷駅");
    expect(fetchCalls()[0].body.lat).toBeUndefined();
  });

  it("3.7 現在地を拒否されたら、場所を文字で入れるよう求め（location_required）、要求しない", async () => {
    installGeolocation({ mode: "deny" });
    const { TEXTS } = await loadWeb("lib/domain/texts");
    await renderApp();
    fireEvent.change(screen.getByTestId(TID.field("party")), { target: { value: "2" } });
    fireEvent.click(screen.getByTestId(TID.btn("fetch")));
    const msg = await screen.findByTestId(TID.msg("place"));
    expect(msg.textContent).toBe(TEXTS.inputRefusal("location_required"));
    expect(fetchCalls()).toHaveLength(0);
    expect(screen.getByTestId(TID.btn("fetch"))).toBeTruthy();
  });

  it("3.8 現在地が5秒返らなければ取れなかったものとして扱う（偽の時計）", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    installGeolocation({ mode: "hang" });
    await renderApp();
    fireEvent.change(screen.getByTestId(TID.field("party")), { target: { value: "2" } });
    fireEvent.click(screen.getByTestId(TID.btn("fetch")));
    await vi.advanceTimersByTimeAsync(4_000);
    expect(screen.queryByTestId(TID.msg("place"))).toBeNull();
    await vi.advanceTimersByTimeAsync(1_500);
    await waitFor(() => expect(screen.getByTestId(TID.msg("place"))).toBeTruthy());
    expect(fetchCalls()).toHaveLength(0);
  });

  it("3.3〜3.6・3.11 断りの応答（place too_long／party required・out_of_range・not_integer／place_unresolved）で、場所か人数の欄の直下に文が出て、入れた内容が残り、取得の画面のまま、結果の一覧は出ない。fields と kind を変えると出る欄と文が変わる", async () => {
    installGeolocation({ mode: "ok", coords: { latitude: 35.2, longitude: 139.2 } });
    let response: any = invalidInput([{ name: "place", reason: "too_long" }]);
    await renderApp({ "POST /api/customer/fetch": () => response });
    fireEvent.change(screen.getByTestId(TID.field("place")), { target: { value: "あ".repeat(51) } });
    fireEvent.change(screen.getByTestId(TID.field("party")), { target: { value: "0" } });
    fireEvent.click(within(screen.getByTestId(TID.field("genres"))).getByTestId("genre-中華"));
    fireEvent.click(screen.getByTestId(TID.btn("fetch")));
    const placeMsg = (await screen.findByTestId(TID.msg("place"))).textContent;
    expect(screen.queryByTestId(TID.msg("party"))).toBeNull();
    const seen = new Set<string>([placeMsg!]);
    for (const reason of ["required", "out_of_range", "not_integer"]) {
      response = invalidInput([{ name: "party", reason }]);
      fireEvent.click(screen.getByTestId(TID.btn("fetch")));
      await waitFor(() => expect(screen.getByTestId(TID.msg("party")).textContent).not.toBe(""));
      await waitFor(() => expect(screen.queryByTestId(TID.msg("place"))).toBeNull());
      const t = screen.getByTestId(TID.msg("party")).textContent!;
      expect(seen.has(t), reason).toBe(false);
      seen.add(t);
    }
    response = refusal("place_unresolved", { fields: [{ name: "place", reason: "not_allowed" }] });
    fireEvent.click(screen.getByTestId(TID.btn("fetch")));
    await waitFor(() => expect(screen.getByTestId(TID.msg("place")).textContent).toMatch(/現在地|入れ直/));
    expect(screen.queryByTestId(TID.msg("party"))).toBeNull();
    expect((screen.getByTestId(TID.field("place")) as HTMLInputElement).value).toBe("あ".repeat(51));
    expect((screen.getByTestId(TID.field("party")) as HTMLInputElement).value).toBe("0");
    expect((within(screen.getByTestId(TID.field("genres"))).getByTestId("genre-中華") as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByTestId("result-list")).toBeNull();
    expect(screen.getByTestId(TID.btn("fetch"))).toBeTruthy();
  });
});
