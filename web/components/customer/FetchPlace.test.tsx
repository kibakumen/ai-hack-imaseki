// @vitest-environment jsdom
// 場所の欄が「開いた瞬間に現在地の地名で埋まっている」ことの検査（2026-09-22 の本人の指摘）。
//
//   「基本的に現在地を使うボタンの下にある自由入力欄に書いてある場所を客は発信する場所だと認識するので、
//     まず、開いた瞬間にここに現在地の文字に変換した場所が入っていて…」
//   「この時、入力欄の中身が現在地でなくなったら『現在地を使う』ボタンを微妙にホバーさせたりなどで強調し…」
//
// ⚠️ **なぜ単体の検査を置いたか**: 受け入れ検査 `r03-fetch-input.ui.test.tsx` は 3.1・3.2 を
// 「欄が空なら座標を送り、文字があれば文字を送る」として見ており、**地名を入れる入口を持たない**
// （偽物に `/api/customer/place` が無い＝欄は空のまま）。地名が入った状態でも座標を送ること・
// 書き換えたら文字を送ることは、この検査が固定する。
//
// ⚠️ **ブラウザの位置の仕組みは差し替え口ごと偽物にする**（`navigator` を直に触らない）。
// 構造の検査（`structure.test.ts` の 3.9）は、`web/` の中でその呼び出しの名前が出てくるのは
// `lib/client/geolocation.ts` だけであることを見張っており、**検査のファイルも `web/` の中**なので
// ここで直に触ると落ちる。だから `lib/client/geolocation` をまるごと差し替える。
//
// 見るのは5つ:
//   1. 開いた瞬間に現在地を取り、地名に直して欄へ入れる
//   2. 欄が地名のままなら、送るのは**座標**（地名を送り直して丸めない）
//   3. 客が書き換えたら、送るのは**その文字**（座標は送らない）
//   4. 書き換えている間は「現在地を使う」が強調され、押すと現在地の地名へ戻る
//   5. 現在地が取れなくても押せる（押した時に場所を求める）

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FetchForm } from "./FetchForm";

const HERE = { lat: 35.6595, lng: 139.7005 };
const LABEL = "東京都渋谷区道玄坂1-1";
/** 現在地が取れなかったときの断り（正本は `lib/client/geolocation.ts`。形だけを写す） */
const LOCATION_REQUIRED = { ok: false, error: { kind: "location_required", fields: [{ name: "place", reason: "required" }] } };

/** 位置の仕組みの返し方を、検査ごとに差し替える（`vi.mock` は import より上へ持ち上がる）。 */
let located: unknown = { ok: true, ...HERE };
vi.mock("../../lib/client/geolocation", () => ({ currentLocation: async () => located }));

type FakeResponse = { status?: number; json?: unknown };

type Call = { method: string; path: string; body: Record<string, unknown> | null; url: URL };

const installFetch = (respond: (method: string, path: string) => FakeResponse) => {
  const calls: Call[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, path: url.pathname, body: typeof init?.body === "string" ? JSON.parse(init.body) : null, url });
    const out = respond(method, url.pathname);
    return new Response(JSON.stringify(out.json ?? { ok: true }), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = previous; } };
};

/** 少しずつ届く入口は持たない場面（普通の入口へ倒れる）。 */
const routes = (method: string, path: string): FakeResponse => {
  if (path === "/api/customer/place") return { json: { label: LABEL } };
  if (path === "/api/customer/fetch/stream") return { status: 404, json: { ok: false } };
  if (method === "POST" && path === "/api/customer/fetch") return { json: { ok: true, fetchId: "f1", items: [] } };
  return { status: 404, json: { ok: false } };
};

const fetchBody = (calls: Call[]): Array<Record<string, unknown>> =>
  calls.filter((c) => c.method === "POST" && c.path === "/api/customer/fetch").map((c) => c.body ?? {});

describe("場所の欄と現在地", () => {
  let fake: ReturnType<typeof installFetch> | null = null;

  beforeEach(() => {
    located = { ok: true, ...HERE };
  });

  afterEach(() => {
    cleanup();
    fake?.restore();
    fake = null;
  });

  const renderForm = () => {
    fake = installFetch(routes);
    render(<FetchForm party="2" onPartyChange={vi.fn()} onResults={vi.fn()} />);
    return screen.getByTestId("field-place") as HTMLInputElement;
  };

  it("開いた瞬間に現在地を取り、地名に直して欄へ入れる（座標を問い合わせに載せる）", async () => {
    const field = renderForm();
    await waitFor(() => expect(field.value).toBe(LABEL));
    const asked = fake!.calls.find((c) => c.path === "/api/customer/place")!;
    expect(asked.url.searchParams.get("lat")).toBe(String(HERE.lat));
    expect(asked.url.searchParams.get("lng")).toBe(String(HERE.lng));
    expect(screen.getByTestId("locate-status").textContent).toContain(LABEL);
  });

  it("欄が現在地の地名のままなら、送るのは座標（地名は送らない）", async () => {
    const field = renderForm();
    await waitFor(() => expect(field.value).toBe(LABEL));

    fireEvent.click(screen.getByTestId("btn-fetch"));
    await waitFor(() => expect(fetchBody(fake!.calls)).toHaveLength(1));
    expect(fetchBody(fake!.calls)[0]).toMatchObject(HERE);
    expect(fetchBody(fake!.calls)[0].place).toBeUndefined();
  });

  it("客が書き換えたら、送るのはその文字（座標は送らない）", async () => {
    const field = renderForm();
    await waitFor(() => expect(field.value).toBe(LABEL));

    fireEvent.change(field, { target: { value: "渋谷駅" } });
    fireEvent.click(screen.getByTestId("btn-fetch"));
    await waitFor(() => expect(fetchBody(fake!.calls)).toHaveLength(1));
    expect(fetchBody(fake!.calls)[0].place).toBe("渋谷駅");
    expect(fetchBody(fake!.calls)[0].lat).toBeUndefined();
  });

  it("書き換えている間は「現在地を使う」が強調され、押すと現在地の地名へ戻る", async () => {
    const field = renderForm();
    await waitFor(() => expect(field.value).toBe(LABEL));
    expect(screen.getByTestId("btn-use-location").className).not.toContain("use-location-away");

    fireEvent.change(field, { target: { value: "新宿" } });
    await waitFor(() => expect(screen.getByTestId("btn-use-location").className).toContain("use-location-away"));

    fireEvent.click(screen.getByTestId("btn-use-location"));
    await waitFor(() => expect(field.value).toBe(LABEL));
    expect(screen.getByTestId("btn-use-location").className).not.toContain("use-location-away");
  });

  it("現在地が取れなくても押せる。押した時に場所を求める（欄の直下に文が出て、要求は出ない）", async () => {
    located = LOCATION_REQUIRED;
    renderForm();
    await waitFor(() => expect(screen.getByTestId("locate-status").textContent).toMatch(/取れませんでした/));
    const button = screen.getByTestId("btn-fetch") as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    fireEvent.click(button);
    await screen.findByTestId("msg-place");
    expect(fetchBody(fake!.calls)).toHaveLength(0);
  });
});
