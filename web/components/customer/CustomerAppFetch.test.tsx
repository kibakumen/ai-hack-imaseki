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
import { replyToResponse, streamOfResult, type FakeReply } from "../../../tests/acceptance/v2/_fakes";

vi.mock("../../lib/client/geolocation", () => ({
  currentLocation: async () => ({ ok: false, error: { kind: "location_required", fields: [{ name: "place", reason: "required" }] } }),
}));

type Answer = FakeReply;

const installFetch = (respond: (method: string, path: string) => Answer) => {
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const out = respond((init?.method ?? "GET").toUpperCase(), url.pathname);
    return replyToResponse(out);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = previous;
  };
};

const ITEM = { offerId: "o1", storeId: "s1", storeName: "店", walkMinutes: 3, budgetMin: 1000, budgetMax: 3000, reason: "近い", partyMax: 4, coupons: [], storeUrl: null, storeAddress: null };
const HOME = { kind: "fetch", profile: { nickname: "guest-abc", phone: "0000000000", genres: [], budgetMax: null } };

describe("取得の画面の入れ物", () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    cleanup();
    restore?.();
    restore = null;
  });

  /**
   * 取得は本番と同じく少しずつ届く入口（NDJSON）で返す（2026-09-25 設計-03。以前はわざと 404 にして普通の入口へ倒していた）。
   * `streamMissing` は、少しずつ届く入口を持たないサーバー（404）の場面——普通の入口へ倒れる道を見るときだけ使う。
   */
  const renderApp = async (items: unknown[], opts: { streamMissing?: boolean } = {}) => {
    const calls: Array<{ method: string; path: string }> = [];
    restore = installFetch((method, path) => {
      calls.push({ method, path });
      if (path === "/api/config/public") return { json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } };
      if (path === "/api/customer/home") return { json: HOME };
      if (method === "POST" && path === "/api/customer/fetch/stream") {
        if (opts.streamMissing) return { status: 404, json: { ok: false, error: { kind: "not_found" } } };
        return { stream: streamOfResult({ fetchId: "f1", items: items as Array<{ storeId: string; reason: string }> }) };
      }
      if (method === "POST" && path === "/api/customer/fetch") return { json: { ok: true, fetchId: "f1", items } };
      return { status: 404, json: { ok: false } };
    });
    render(<CustomerApp />);
    await screen.findByTestId("btn-fetch");
    return calls;
  };
  const postsTo = (calls: Array<{ method: string; path: string }>, path: string) => calls.filter((c) => c.method === "POST" && c.path === path).length;

  it("人数は最初から 1 が入っている", async () => {
    await renderApp([]);
    expect((screen.getByTestId("field-party") as HTMLInputElement).value).toBe("1");
  });

  // 客-07: 人数が「入れなくても探せます」の中に既定1で置かれ、増減のボタンも無く、4人連れでも1名のまま確保しやすかった
  it("人数は「今すぐ探す」の直前（こだわり条件の外）に −/＋ つきで置かれ、ボタンの文言に今の人数が載る", async () => {
    await renderApp([]);
    const party = screen.getByTestId("field-party") as HTMLInputElement;
    const button = screen.getByTestId("btn-fetch");
    const form = screen.getByTestId("form-fetch");
    expect(form.querySelector(".fetch-options")!.contains(party)).toBe(false);
    expect(party.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button.textContent).toBe("1名で今すぐ探す");

    const minus = screen.getByTestId("btn-party-minus") as HTMLButtonElement;
    const plus = screen.getByTestId("btn-party-plus") as HTMLButtonElement;
    expect(minus.disabled).toBe(true);
    fireEvent.click(plus);
    fireEvent.click(plus);
    fireEvent.click(plus);
    expect(party.value).toBe("4");
    expect(button.textContent).toBe("4名で今すぐ探す");
    fireEvent.click(minus);
    expect(party.value).toBe("3");

    fireEvent.change(party, { target: { value: "10" } });
    expect(plus.disabled).toBe(true);
    // 数にならない値のときは人数を載せない（断りは入口が返す）
    fireEvent.change(party, { target: { value: "" } });
    expect(button.textContent).toBe("今すぐ探す");
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

  it("少しずつ届く入口が無い（404）サーバーでは、普通の入口へ1回だけ倒れて結果のカードが出る", async () => {
    const calls = await renderApp([ITEM], { streamMissing: true });
    fireEvent.change(screen.getByTestId("field-place"), { target: { value: "渋谷" } });
    fireEvent.click(screen.getByTestId("btn-fetch"));
    const card = await screen.findByTestId("result-o1");
    expect(postsTo(calls, "/api/customer/fetch/stream")).toBe(1);
    expect(postsTo(calls, "/api/customer/fetch")).toBe(1);
    // 普通の入口には紹介文を後から差し込む道が無いので、待機の見た目で固めない（不具合-21）
    expect(card.querySelector('[aria-busy="true"]')).toBeNull();
    expect(card.textContent).not.toContain("書いています");
  });

  it("少しずつ届く入口が働くサーバーでは、普通の入口を呼ばない", async () => {
    const calls = await renderApp([ITEM]);
    fireEvent.change(screen.getByTestId("field-place"), { target: { value: "渋谷" } });
    fireEvent.click(screen.getByTestId("btn-fetch"));
    await screen.findByTestId("result-o1");
    expect(postsTo(calls, "/api/customer/fetch/stream")).toBe(1);
    expect(postsTo(calls, "/api/customer/fetch")).toBe(0);
  });

  // 不具合-06: 受け取ったあとも前のストリームが結果を入れ直し、確保を取り消すと古い一覧が出ていた
  it("受け取りが通ったあとに前の取得の紹介文が届いても、結果の一覧へ戻らない（前の取得を止める）", async () => {
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    const reservation = { id: "res-1", code: "12345678", storeId: "s1", storeName: "店", storeAddress: "東京都渋谷区1-1", storeUrl: null, party: 1, expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(), status: "active", coupons: [] };
    const active = { ...HOME, kind: "active", reservation };
    let received = false;
    restore = installFetch((method, path) => {
      if (path === "/api/config/public") return { json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } };
      if (path === "/api/customer/home") return { json: received ? active : HOME };
      if (method === "POST" && path === "/api/customer/fetch/stream") return { stream: streamOfResult({ fetchId: "f1", items: [ITEM] }, { holdAfter: 1, release: released }) };
      if (method === "POST" && path === "/api/customer/reservations") {
        received = true;
        return { status: 201, json: { ok: true, reservation, home: active } };
      }
      if (method === "POST" && path === "/api/customer/reservations/res-1/cancel") {
        received = false;
        return { json: { ok: true, home: HOME } };
      }
      return { status: 404, json: { ok: false } };
    });
    render(<CustomerApp />);
    await screen.findByTestId("btn-fetch");
    fireEvent.change(screen.getByTestId("field-place"), { target: { value: "渋谷" } });
    fireEvent.click(screen.getByTestId("btn-fetch"));
    fireEvent.click(await screen.findByTestId("btn-receive"));
    await screen.findByTestId("view-active");
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    // 確保を取り消して取得の画面へ戻っても、前の取得の一覧は出ない
    fireEvent.click(screen.getByTestId("btn-close-celebration"));
    fireEvent.click(screen.getByTestId("btn-cancel"));
    fireEvent.click(await screen.findByTestId("btn-confirm"));
    await waitFor(() => expect(screen.queryByTestId("view-active")).toBeNull());
    await screen.findByTestId("btn-fetch");
    expect(screen.queryByTestId("result-o1")).toBeNull();
  });
});
