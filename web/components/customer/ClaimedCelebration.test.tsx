// @vitest-environment jsdom
// 受け取りが通った瞬間の演出（2026-09-22 の本人の指摘）。
//
//   「受け取った瞬間にファンファーレみたいなエフェクトが欲しい」
//   「別画面に遷移してオファー承諾の楽しい演出をつけ、オファーを前面に出し、
//     …すぐに経路情報を保ったままGoogleマップを起動できるように」
//
// ⚠️ **確保中の表示（`view-active`）を消さないこと**が要る——受け入れ検査
// `r08-receive.ui.test.tsx` の 8.5 が「受け取りが通ると確保中の表示へ移る」を見ており、
// `r09-reservation-view.ui.test.tsx` の 9.1 は「店の URL が無ければ `view-active` の中に
// http のリンクが1つも無い」を見ている。だから経路のリンクは**重ねる1枚の側**に置く。
// この検査はその2点（重なる・下が残る）と、経路のリンクの中身を固定する。
//
// 経路の**出発地**（3回目の指摘・2026-09-22）: 「現在地と違う場所を入力して探しても Googleマップの
// 開始地点には現在地が渡される」。出発地の出どころは3段——①確保の応答に載る起点（サーバーが
// `fetch_logs` から返す・端末の状態に依らない）②探した結果に載る起点 ③そのタブで覚えた起点。
// ①が在れば `sessionStorage` が使えない環境でも渡る。**どれも無いときだけ `origin` を付けない**
// （嘘の起点を付けるより、マップに現在地から引かせる方がまし）。

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomerApp } from "./CustomerApp";

// ⚠️ ブラウザの位置の仕組みは差し替え口ごと偽物にする（`navigator` を直に触らない）。構造の検査
// （`structure.test.ts` の 3.9）は `web/` の中でその呼び出しの名前が `lib/client/geolocation.ts`
// だけに在ることを見張っており、**検査のファイルも `web/` の中**なので直に触ると落ちる。
vi.mock("../../lib/client/geolocation", () => ({ currentLocation: async () => ({ ok: true, lat: 35.6, lng: 139.7 }) }));

type FakeResponse = { status?: number; json?: unknown };

const RESERVATION = {
  id: "res-1",
  code: "87654321",
  storeId: "store-1",
  storeName: "受け取りの店",
  storeAddress: "東京都渋谷区道玄坂1-1",
  storeUrl: null,
  party: 2,
  expiresAt: "2026-09-22T06:20:00.000Z",
  status: "active",
  coupons: [{ name: "生ビール1杯", note: "1組1回" }],
};
/** 探した場所をサーバーが座標に直して記録した値（打った場所の文字とは別の値にして、どちらが渡ったか見分ける）。 */
const SERVER_ORIGIN = { lat: 35.6896, lng: 139.7006 };
const ITEM = { offerId: "o1", storeId: "s1", storeName: "店A", walkMinutes: 3, budgetMin: 2000, budgetMax: 4000, reason: "合います", partyMax: 4, coupons: [], storeUrl: null };

const installFetch = (respond: (method: string, path: string) => FakeResponse) => {
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    const out = respond((init?.method ?? "GET").toUpperCase(), path);
    return new Response(JSON.stringify(out.json ?? { ok: true }), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = previous; } };
};

/**
 * `sessionStorage` に触ると投げる環境（iOS Safari の「すべての Cookie をブロック」・site data 停止）。
 * 新しいタブ・別のタブでは中身が空になるのも、渡るものが無い点では同じ場面。
 */
const blockSessionStorage = () => {
  const original = Object.getOwnPropertyDescriptor(window, "sessionStorage");
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    get: () => {
      throw new DOMException("blocked", "SecurityError");
    },
  });
  return {
    restore: () => {
      if (original) Object.defineProperty(window, "sessionStorage", original);
      else delete (window as { sessionStorage?: unknown }).sessionStorage;
    },
  };
};

type Scene = {
  /** 場所の欄に打つ文字（空なら現在地のまま＝座標で探す） */
  typed?: string;
  /** 確保の応答（と、その後のホーム）に起点を載せるか */
  serverOrigin?: boolean;
};

describe("受け取ったあとの演出", () => {
  let fake: ReturnType<typeof installFetch> | null = null;
  let storage: ReturnType<typeof blockSessionStorage> | null = null;

  afterEach(() => {
    cleanup();
    fake?.restore();
    fake = null;
    storage?.restore();
    storage = null;
    window.localStorage.clear();
    try {
      window.sessionStorage.clear();
    } catch {
      // 止めた検査のあとは触れないことがある
    }
  });

  /** 探して1件受け取るところまで進める。 */
  const receiveOne = async ({ typed = "", serverOrigin = false }: Scene = {}) => {
    let held = false;
    const reservation = serverOrigin ? { ...RESERVATION, origin: SERVER_ORIGIN } : RESERVATION;
    fake = installFetch((method, path) => {
      if (path === "/api/config/public") return { json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } };
      if (path === "/api/customer/home") {
        return { json: held ? { kind: "active", profile: {}, reservation } : { kind: "fetch", profile: {} } };
      }
      if (path === "/api/customer/place") return { json: { label: null } };
      if (path === "/api/customer/fetch/stream") return { status: 404, json: { ok: false } };
      if (method === "POST" && path === "/api/customer/fetch") return { json: { ok: true, fetchId: "f1", items: [ITEM] } };
      if (method === "POST" && path === "/api/customer/reservations") {
        held = true;
        return { json: { ok: true, reservation, home: { kind: "active", profile: {}, reservation } } };
      }
      return { status: 404, json: { ok: false } };
    });

    render(<CustomerApp />);
    await screen.findByTestId("btn-fetch");
    fireEvent.change(screen.getByTestId("field-party"), { target: { value: "2" } });
    if (typed !== "") fireEvent.change(screen.getByTestId("field-place"), { target: { value: typed } });
    fireEvent.click(screen.getByTestId("btn-fetch"));
    const card = await screen.findByTestId("result-o1");
    fireEvent.click(within(card).getByTestId("btn-receive"));
  };

  /** 前面の1枚の中の経路のリンクの引数。 */
  const routeParams = async () => {
    const celebration = await screen.findByTestId("claimed-celebration");
    const route = within(celebration).getByTestId("link-route") as HTMLAnchorElement;
    expect(route.href).toContain("google.com/maps/dir/");
    return new URL(route.href).searchParams;
  };

  it("受け取ると前面に出て、確保番号と経路のリンクが在る。下の確保中の表示は消えない", async () => {
    await receiveOne();
    const celebration = await screen.findByTestId("claimed-celebration");
    expect(within(celebration).getByTestId("claimed-code").textContent).toBe("87654321");
    expect(celebration.textContent).toContain("受け取りの店");

    const route = within(celebration).getByTestId("link-route") as HTMLAnchorElement;
    expect(route.href).toContain("google.com/maps/dir/");
    // 行き先は店名と住所（`URLSearchParams` は空白を `+` に直すので、値は解いてから見る）
    const params = new URL(route.href).searchParams;
    expect(params.get("destination")).toBe("受け取りの店 東京都渋谷区道玄坂1-1");
    expect(params.get("travelmode")).toBe("walking");

    // 下の確保中の表示は残っている（閉じれば戻る先が在る・r08 の 8.5 もこれを見ている）
    const view = screen.getByTestId("view-active");
    expect(view.textContent).toContain("87654321");
    // 店の URL が無いときに `view-active` の中へ http のリンクを増やしていない（r09 の 9.1）
    expect(view.querySelector("a[href^='http']")).toBeNull();
  });

  it("閉じると演出だけが消えて、確保中の表示がそのまま残る", async () => {
    await receiveOne();
    await screen.findByTestId("claimed-celebration");
    fireEvent.click(screen.getByTestId("btn-close-celebration"));
    await waitFor(() => expect(screen.queryByTestId("claimed-celebration")).toBeNull());
    expect(screen.getByTestId("view-active").textContent).toContain("87654321");
  });

  describe("経路の出発地", () => {
    it("探した起点が座標のとき（欄は現在地のまま）: その座標が origin に渡る", async () => {
      await receiveOne();
      expect((await routeParams()).get("origin")).toBe("35.6,139.7");
    });

    it("打った場所の文字で探したとき: その文字が origin に渡る（現在地ではない）", async () => {
      await receiveOne({ typed: "新宿駅" });
      expect((await routeParams()).get("origin")).toBe("新宿駅");
    });

    it("確保の応答に起点が載っていれば、それを最優先で渡す（端末の状態に依らない）", async () => {
      await receiveOne({ typed: "新宿駅", serverOrigin: true });
      expect((await routeParams()).get("origin")).toBe("35.6896,139.7006");
    });

    it("sessionStorage が使えない環境でも、確保の応答の起点があれば渡る（3つ目の経路）", async () => {
      storage = blockSessionStorage();
      await receiveOne({ typed: "新宿駅", serverOrigin: true });
      expect((await routeParams()).get("origin")).toBe("35.6896,139.7006");
    });

    it("起点が分からないとき（応答に無く・覚えてもいない）: origin を付けない（マップが現在地から引く）", async () => {
      storage = blockSessionStorage();
      await receiveOne({ typed: "新宿駅" });
      const params = await routeParams();
      expect(params.has("origin")).toBe(false);
      expect(params.get("destination")).toBe("受け取りの店 東京都渋谷区道玄坂1-1");
    });
  });
});
