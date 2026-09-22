// @vitest-environment jsdom
// 確保中の画面の「Googleマップで経路を開く」（2026-09-22 の本人の指摘）。
//
//   「確保の画面に戻ったらGoogleマップを探すボタンに辿り着けなくなるので、この画面にもおくようにしてほしい」
//
// この検査が固定するのは4つ:
//   1. 確保中の画面（読み直したあと＝探した結果も演出も無い状態）に経路のボタンが在る
//   2. 出発地は確保の応答に載る起点（サーバーが `fetch_logs` から返す座標）——端末の保存に依らない
//   3. 応答に起点が無く、タブの覚えも無ければ `origin` を付けない（嘘の起点を付けない）
//   4. `view-active` の中に http のリンク（`<a>`）を増やしていない（受け入れ検査 r09 の 9.1 が見ている）

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomerApp } from "./CustomerApp";

vi.mock("../../lib/client/geolocation", () => ({ currentLocation: async () => ({ ok: true, lat: 35.6, lng: 139.7 }) }));

const RESERVATION = {
  id: "res-1",
  code: "80785272",
  storeId: "store-1",
  storeName: "受け取りの店",
  storeAddress: "東京都渋谷区道玄坂1-1",
  storeUrl: null,
  party: 2,
  expiresAt: "2026-09-22T06:20:00.000Z",
  status: "active",
  coupons: [],
};

/** 確保中のホームだけを返す偽の入口（読み直したあとの画面＝探した結果は無い）。 */
const installHome = (reservation: Record<string, unknown>) => {
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://localhost").pathname;
    const json =
      path === "/api/customer/home"
        ? { kind: "active", profile: {}, reservation }
        : path === "/api/config/public"
          ? { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null }
          : { ok: true };
    return new Response(JSON.stringify(json), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = previous; } };
};

describe("確保中の画面の経路のボタン", () => {
  let fake: ReturnType<typeof installHome> | null = null;

  afterEach(() => {
    cleanup();
    fake?.restore();
    fake = null;
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  const routeParams = async () => {
    const view = await screen.findByTestId("view-active");
    const button = await screen.findByTestId("btn-route");
    expect(view.contains(button)).toBe(true);
    return new URL(button.getAttribute("data-href") ?? "").searchParams;
  };

  it("確保の応答に起点が載っていれば、その座標を出発地にして開く（探した結果も演出も無い読み直しのあと）", async () => {
    fake = installHome({ ...RESERVATION, origin: { lat: 35.6896, lng: 139.7006 } });
    render(<CustomerApp />);
    const params = await routeParams();
    expect(params.get("origin")).toBe("35.6896,139.7006");
    expect(params.get("destination")).toBe("受け取りの店 東京都渋谷区道玄坂1-1");
    expect(params.get("travelmode")).toBe("walking");
  });

  it("応答に起点が無ければタブの覚えで補い、それも無ければ origin を付けない", async () => {
    window.sessionStorage.setItem("imaseki.lastOrigin", JSON.stringify({ place: "新宿駅" }));
    fake = installHome(RESERVATION);
    render(<CustomerApp />);
    expect((await routeParams()).get("origin")).toBe("新宿駅");
    cleanup();
    fake.restore();
    window.sessionStorage.clear();

    fake = installHome(RESERVATION);
    render(<CustomerApp />);
    const params = await routeParams();
    expect(params.has("origin")).toBe(false);
    expect(params.get("destination")).toBe("受け取りの店 東京都渋谷区道玄坂1-1");
  });

  it("ボタンは半券の直下・操作の囲いより上に在り、店の URL が無いとき view-active に http のリンクを増やさない", async () => {
    fake = installHome({ ...RESERVATION, origin: { lat: 35.6896, lng: 139.7006 } });
    render(<CustomerApp />);
    const view = await screen.findByTestId("view-active");
    const button = await screen.findByTestId("btn-route");
    expect(view.querySelector("a[href^='http']")).toBeNull();
    // 並び: 半券（番号）→ 経路 → 人数の変更（操作）
    const ticket = screen.getByTestId("reservation-code");
    const party = screen.getByTestId("form-party");
    expect(ticket.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.compareDocumentPosition(party) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // 押すと新しいタブで開く（リンクと同じ振る舞い）
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    fireEvent.click(button);
    expect(open).toHaveBeenCalledWith(button.getAttribute("data-href"), "_blank", "noopener,noreferrer");
    open.mockRestore();
  });
});
