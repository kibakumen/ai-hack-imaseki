// @vitest-environment jsdom
// 場所の欄が「開いた瞬間に現在地の地名で埋まっている」ことの検査（2026-09-22 の本人の指摘）。
//
//   「基本的に現在地を使うボタンの下にある自由入力欄に書いてある場所を客は発信する場所だと認識するので、
//     まず、開いた瞬間にここに現在地の文字に変換した場所が入っていて…」
//   「この時、入力欄の中身が現在地でなくなったら『現在地を使う』ボタンを微妙にホバーさせたりなどで強調し…」
//
// ⚠️ 2026-09-25 監査の指摘 安全-18（案3）: 開いた瞬間に座標を地図のサービスへ送り始めない。開いた瞬間に
// 埋めるのは、**客が一度「現在地を使う」を押した端末だけ**（押したことは端末に覚える）。
//
// ⚠️ **なぜ単体の検査を置いたか**: 受け入れ検査 `r03-fetch-input.ui.test.tsx` は 3.1・3.2 を
// 「欄が空なら座標を送り、文字があれば文字を送る」として見ており、**地名を入れる入口を持たない**
// （偽物に `/api/customer/place` が無い＝欄は空のまま）。地名が入った状態でも座標を送ること・
// 書き換えたら文字を送ることは、この検査が固定する。
//
// ⚠️ **ブラウザの位置の仕組みは差し替え口ごと偽物にする**（`navigator` を直に触らない）。
// 構造の検査（`structure.test.ts` の 3.9）は、`web/` の中でその呼び出しの名前が出てくるのは
// `lib/client/geolocation.ts` だけであることを見張っており、**検査のファイルも `web/` の中**なので
// ここで直に触ると落ちる。だから `lib/client/geolocation` の `currentLocation` を差し替える。
//
// 見るのは:
//   1. 初めての端末では、開いただけでは位置も地名の問い合わせも送らない。「現在地を使う」を押すと取って地名を入れ、
//      押したことを覚える（次に開いたときは開いた瞬間に入れる）
//   2. 押したことのある端末では、開いた瞬間に現在地を取り、地名に直して欄へ入れる
//   3. 欄が地名のままなら、送るのは**座標**（地名を送り直して丸めない）
//   4. 客が書き換えたら、送るのは**その文字**（座標は送らない）
//   5. 書き換えている間は「現在地を使う」が強調され、押すと現在地の地名へ戻る
//   6. 現在地が取れなくても押せる（押した時に場所を求める）
//   7. 地名を問い合わせている間は、失敗の文を出さない（客-10）
//   8. 許可を断られたら、取れなかったときと別の文を出し、欄の説明を替える（客-09）

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FetchForm } from "./FetchForm";
import { replyToResponse, streamOfResult, type FakeReply } from "../../../tests/acceptance/v2/_fakes";

const HERE = { lat: 35.6595, lng: 139.7005 };
const LABEL = "東京都渋谷区道玄坂1-1";
/** 現在地が取れなかったときの断り（正本は `lib/client/geolocation.ts`。形だけを写す） */
const LOCATION_REQUIRED = { ok: false, error: { kind: "location_required", fields: [{ name: "place", reason: "required" }] } };
/** 許可を断られたときの断り（語は同じで `denied` の印が付く） */
const LOCATION_DENIED = { ok: false, error: { kind: "location_required", fields: [{ name: "place", reason: "required" }], denied: true } };
/** 押したことを端末に覚える鍵（正本は `lib/client/locationStatus.ts`） */
const CONSENT_KEY = "imaseki.location-consent";

/** 位置の仕組みの返し方を、検査ごとに差し替える（`vi.mock` は import より上へ持ち上がる）。 */
let located: unknown = { ok: true, ...HERE };
let locateCalls = 0;
vi.mock("../../lib/client/geolocation", () => ({
  currentLocation: async () => {
    locateCalls += 1;
    return located;
  },
}));

type FakeResponse = FakeReply;

type Call = { method: string; path: string; body: Record<string, unknown> | null; url: URL };

/** 地名の問い合わせの返し方（既定はすぐ地名を返す。遅らせたい検査は差し替える）。 */
let placeReply: () => FakeResponse | Promise<FakeResponse> = () => ({ json: { label: LABEL } });

const installFetch = () => {
  const calls: Call[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, path: url.pathname, body: typeof init?.body === "string" ? JSON.parse(init.body) : null, url });
    if (url.pathname === "/api/customer/place") return replyToResponse(await placeReply());
    // 取得は本番と同じく少しずつ届く入口（NDJSON）で返す（2026-09-25 設計-03）
    if (method === "POST" && url.pathname === "/api/customer/fetch/stream") return replyToResponse({ stream: streamOfResult({ fetchId: "f1", items: [] }) });
    if (method === "POST" && url.pathname === "/api/customer/fetch") return replyToResponse({ json: { ok: true, fetchId: "f1", items: [] } });
    return replyToResponse({ status: 404, json: { ok: false } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = previous; } };
};

const fetchBody = (calls: Call[]): Array<Record<string, unknown>> =>
  calls.filter((c) => c.method === "POST" && (c.path === "/api/customer/fetch" || c.path === "/api/customer/fetch/stream")).map((c) => c.body ?? {});

describe("場所の欄と現在地", () => {
  let fake: ReturnType<typeof installFetch> | null = null;

  beforeEach(() => {
    located = { ok: true, ...HERE };
    locateCalls = 0;
    placeReply = () => ({ json: { label: LABEL } });
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    fake?.restore();
    fake = null;
    window.localStorage.clear();
  });

  const renderForm = ({ consented = true }: { consented?: boolean } = {}) => {
    if (consented) window.localStorage.setItem(CONSENT_KEY, "1");
    fake = installFetch();
    render(<FetchForm party="2" onPartyChange={vi.fn()} onResults={vi.fn()} />);
    return screen.getByTestId("field-place") as HTMLInputElement;
  };

  it("初めての端末では、開いただけでは位置も地名の問い合わせも送らない。押すと取って地名を入れ、押したことを覚える", async () => {
    const field = renderForm({ consented: false });
    // 押す前に、押すと何がどこへ送られるかを添える（送信先の一覧へつなぐ）
    expect(screen.getByTestId("locate-note").textContent).toMatch(/Google/);
    expect(screen.getByTestId("locate-note").querySelector('a[href="/privacy"]')).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(locateCalls).toBe(0);
    expect(fake!.calls.filter((c) => c.path === "/api/customer/place")).toHaveLength(0);
    expect(field.value).toBe("");

    fireEvent.click(screen.getByTestId("btn-use-location"));
    await waitFor(() => expect(field.value).toBe(LABEL));
    expect(locateCalls).toBe(1);
    expect(window.localStorage.getItem(CONSENT_KEY)).toBe("1");
  });

  it("押したことのある端末では、開いた瞬間に現在地を取り、地名に直して欄へ入れる（座標を問い合わせに載せる）", async () => {
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
    const field = renderForm();
    await waitFor(() => expect(screen.getByTestId("locate-status").textContent).toMatch(/取れませんでした/));
    expect(field.placeholder).toBe("駅名や住所を入れてください");
    const button = screen.getByTestId("btn-fetch") as HTMLButtonElement;
    expect(button.disabled).toBe(false);

    fireEvent.click(button);
    await screen.findByTestId("msg-place");
    expect(fetchBody(fake!.calls)).toHaveLength(0);
  });

  // 客-10: 「取れた」を先に立ててから地名を問い合わせていたので、問い合わせの往復の間ずっと失敗の文が出ていた
  it("地名を問い合わせている間は失敗の文を出さず、問い合わせが終わっても地名が無いときだけ出す", async () => {
    let answer!: (reply: FakeResponse) => void;
    placeReply = () => new Promise<FakeResponse>((resolve) => (answer = resolve));
    renderForm();
    await waitFor(() => expect(screen.getByTestId("locate-status").textContent).toMatch(/地名を調べています/));
    expect(screen.getByTestId("locate-status").textContent).not.toMatch(/できませんでした/);

    answer({ json: { label: null } });
    await waitFor(() => expect(screen.getByTestId("locate-status").textContent).toMatch(/地名にはできませんでした/));
  });

  // 客-09: 許可を断った客にも「空のままなら今いる場所で探します」と案内していた
  it("許可を断られたら、取れなかったときと別の文を出し、欄の説明を「駅名や住所を入れてください」に替える", async () => {
    located = LOCATION_DENIED;
    const field = renderForm();
    await waitFor(() => expect(screen.getByTestId("locate-status").textContent).toMatch(/許可されていません/));
    expect(screen.getByTestId("locate-status").textContent).not.toMatch(/取れませんでした/);
    expect(field.placeholder).toBe("駅名や住所を入れてください");
  });
});
