// @vitest-environment jsdom
// 残り時間と期限切れの表示（2026-09-25 監査の指摘 客-06・横断-07 の案A）。
//
//   客-06   … 確保中は「期限 HH:MM まで」だけで残り時間が出ず、期限が切れると住所・経路と、受け取り直せない理由
//             （店が「何名まで」を下げた）が消えた。20分を過ぎると店名まで消えた
//   横断-07 … 期限を過ぎたらどうなるかが、確保の画面に書いていなかった（期限が切れてから初めて知らされた）

import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { homeFetch, installFakeApi, reservationDto, type FakeApi } from "../../../tests/acceptance/v2/_fakes";
import { CustomerApp } from "./CustomerApp";

vi.mock("../../lib/client/geolocation", () => ({ currentLocation: async () => ({ ok: true, lat: 35.6, lng: 139.7 }) }));

const MIN = 60_000;
const CONFIG = () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } });

let api: FakeApi | null = null;
afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
  vi.useRealTimers();
  window.localStorage.clear();
});

const renderHome = async (home: Record<string, unknown>) => {
  api = installFakeApi({ "GET /api/config/public": CONFIG, "GET /api/customer/home": () => ({ json: home }) });
  render(<CustomerApp />);
};

describe("確保中の残り時間（客-06）と期限を過ぎたときの扱い（横断-07）", () => {
  it("「あと◯分」が出て、時間が進むと減る", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await renderHome(homeFetch({ kind: "active", reservation: reservationDto({ expiresAt: new Date(Date.now() + 12 * MIN - 1000).toISOString() }) }));
    const remaining = await screen.findByTestId("reservation-remaining");
    expect(remaining.textContent).toMatch(/あと\s*12\s*分/);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * MIN);
    });
    expect(screen.getByTestId("reservation-remaining").textContent).toMatch(/あと\s*9\s*分/);
  });

  it("5分を切ったら目立たせ、まもなく期限であることを言う", async () => {
    await renderHome(homeFetch({ kind: "active", reservation: reservationDto({ expiresAt: new Date(Date.now() + 4 * MIN).toISOString() }) }));
    const remaining = await screen.findByTestId("reservation-remaining");
    expect(remaining.className).toMatch(/soon/);
    expect(remaining.textContent).toMatch(/まもなく/);
  });

  it("期限を過ぎると自動で取り消されること、20分以内ならお店の判断で入れることが、確保中の画面に書いてある", async () => {
    await renderHome(homeFetch({ kind: "active", reservation: reservationDto() }));
    const view = await screen.findByTestId("view-active");
    const rule = within(view).getByTestId("reservation-expiry-rule");
    expect(rule.textContent).toMatch(/自動で取り消され/);
    expect(rule.textContent).toMatch(/20分/);
    expect(rule.textContent).toMatch(/お店の判断/);
  });
});

describe("期限切れの表示（客-06）", () => {
  const expiredHome = (expired: Record<string, unknown>, over: Record<string, unknown> = {}) =>
    homeFetch({ kind: "expired", reservation: reservationDto({ status: "expired", party: 4, ...over }), expired } as never);

  it("20分の猶予の間は、店の住所と経路のボタンが出る", async () => {
    await renderHome(expiredHome({ showCode: true, canRetry: true }));
    const view = await screen.findByTestId("view-expired");
    expect(within(view).getByTestId("reservation-address").textContent).toContain("東京都渋谷区道玄坂1-1");
    expect(within(view).getByTestId("btn-route").getAttribute("data-href")).toContain("google.com/maps/dir/");
  });

  it("「何名まで」が下がって受け取り直せないときは、その人数を言い、探し直すときの人数に入れる", async () => {
    await renderHome(expiredHome({ showCode: true, canRetry: false, partyMax: 3 }));
    const view = await screen.findByTestId("view-expired");
    expect(within(view).getByTestId("expired-party-max").textContent).toMatch(/今\s*3\s*名まで/);
    fireEvent.click(within(view).getByTestId("btn-search-again"));
    const party = (await screen.findByTestId("field-party")) as HTMLInputElement;
    expect(party.value).toBe("3");
  });

  it("20分を過ぎてコードが消えても、店名は出る（どの店の確保だったか分かる）", async () => {
    await renderHome(expiredHome({ showCode: false, canRetry: false }, { code: "" }));
    const view = await screen.findByTestId("view-expired");
    expect(view.textContent).toContain("受け取りの店");
    expect(within(view).queryByTestId("btn-route")).toBeNull();
  });
});
