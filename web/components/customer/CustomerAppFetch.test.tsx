// @vitest-environment jsdom
// 取得の画面の入れ物の振る舞い3つ（2026-09-22 の本人の指摘・追加分）。
//
//   「客がオファーを受け取った時に場所やこだわり条件のカードよりもオファーをみたいから条件はスクロールについて
//     追随する形で右下の方に条件を変えるボタンを設置してそこから変えられるようにしてほしい」
//   「人数は最初からデフォルト値の1が埋まっている状態にしてください」
//   「見つからなかったときの文は下の方じゃなくて、すぐ見える上のほうでエラーメッセージとして表示してほしい」
//
// ⚠️ 受け入れ検査（`r03`・`r04`）は人数の初期値・文の位置・畳みを見ていない（`data-testid` で掴むだけ）ので、
// ここが固定する。畳んでも欄が DOM に残ることも見る（受け入れ検査が結果のあとも欄を掴むため）。

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomerApp } from "./CustomerApp";

vi.mock("../../lib/client/geolocation", () => ({
  currentLocation: async () => ({ ok: false, error: { kind: "location_required", fields: [{ name: "place", reason: "required" }] } }),
}));

type Answer = { status?: number; json?: unknown };

const installFetch = (respond: (method: string, path: string) => Answer) => {
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const out = respond((init?.method ?? "GET").toUpperCase(), url.pathname);
    return new Response(JSON.stringify(out.json ?? { ok: true }), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = previous;
  };
};

const ITEM = { offerId: "o1", storeId: "s1", storeName: "店", walkMinutes: 3, budgetMin: 1000, budgetMax: 3000, reason: "近い", partyMax: 4, coupons: [], storeUrl: null };
const HOME = { kind: "fetch", profile: { nickname: "guest-abc", phone: "0000000000", genres: [], budgetMax: null } };

describe("取得の画面の入れ物", () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    cleanup();
    restore?.();
    restore = null;
  });

  const renderApp = async (items: unknown[]) => {
    restore = installFetch((method, path) => {
      if (path === "/api/config/public") return { json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } };
      if (path === "/api/customer/home") return { json: HOME };
      if (path === "/api/customer/fetch/stream") return { status: 404, json: { ok: false } };
      if (method === "POST" && path === "/api/customer/fetch") return { json: { ok: true, fetchId: "f1", items } };
      return { status: 404, json: { ok: false } };
    });
    render(<CustomerApp />);
    await screen.findByTestId("btn-fetch");
  };

  it("人数は最初から 1 が入っている", async () => {
    await renderApp([]);
    expect((screen.getByTestId("field-party") as HTMLInputElement).value).toBe("1");
  });

  it("0件なら、文は「今すぐ探す」のすぐ下（こだわり条件より上）に断りの体裁で出て、条件は畳まない", async () => {
    await renderApp([]);
    fireEvent.change(screen.getByTestId("field-place"), { target: { value: "渋谷" } });
    fireEvent.click(screen.getByTestId("btn-fetch"));
    const empty = await screen.findByTestId("result-empty");
    expect(empty.textContent).toMatch(/見つかりませんでした/);
    expect(empty.textContent).toMatch(/人数/);
    expect(empty.textContent).toMatch(/場所/);
    expect(empty.textContent).toMatch(/時間/);
    expect(empty.className).toContain("msg");
    // 文はフォームの中・ボタンの直後・こだわり条件より前
    const form = screen.getByTestId("form-fetch");
    expect(form.contains(empty)).toBe(true);
    const button = screen.getByTestId("btn-fetch");
    const options = form.querySelector(".fetch-options")!;
    expect(button.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(empty.compareDocumentPosition(options) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(form.className).not.toContain("fetch-form--collapsed");
    expect(screen.queryByTestId("btn-change-conditions")).toBeNull();
  });

  it("1件以上なら条件を畳み（DOM には残す）、右下の「条件を変える」で開き直せる。探し直すと閉じ直す", async () => {
    await renderApp([ITEM]);
    fireEvent.change(screen.getByTestId("field-place"), { target: { value: "渋谷" } });
    fireEvent.click(screen.getByTestId("btn-fetch"));
    await screen.findByTestId("result-o1");

    const form = screen.getByTestId("form-fetch");
    expect(form.className).toContain("fetch-form--collapsed");
    // 畳んでも欄は残る
    expect(screen.getByTestId("field-party")).toBeTruthy();
    expect(screen.queryByTestId("result-empty")).toBeNull();

    const fab = screen.getByTestId("btn-change-conditions");
    expect(fab.textContent).toBe("条件を変える");
    fireEvent.click(fab);
    expect(form.className).not.toContain("fetch-form--collapsed");
    expect(fab.textContent).toBe("条件を閉じる");

    // 探し直すと閉じ直す
    fireEvent.click(screen.getByTestId("btn-fetch"));
    await waitFor(() => expect(screen.getByTestId("form-fetch").className).toContain("fetch-form--collapsed"));
  });
});
