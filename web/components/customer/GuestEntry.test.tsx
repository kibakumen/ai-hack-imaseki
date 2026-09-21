// @vitest-environment jsdom
// 「開いた瞬間に今すぐ探すボタンを押せる」ことの検査（2026-09-22 の本人の指摘）。
//
// ⚠️ **なぜ単体の検査を置いたか**: 受け入れ検査 `r01-customer-register.ui.test.tsx` は
// 「ホームが 401 なら登録の入力を出す」（基準 1.10・1.11）を **`CustomerApp` に対して**見ており、
// 部品の描き方はそのまま正しい。変えたのは「実際のアプリが 401 のままにならないこと」だけで、
// それを担うのが `GuestEntry`。受け入れ検査がこの1枚を描かないので、ここで振る舞いを固定する。
//
// 見るのは4つ:
//   1. 識別子が無ければ、客に何も聞かずに登録を送る（呼び名は自動・電話番号は仮の値）
//   2. 登録が通れば、客が見るのは取得の画面（登録の入力は出ない）
//   3. 登録が断られたら、手で入れる登録の入力へ倒れる（受け皿）
//   4. 既に識別子を持っていれば、登録は送らない

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GuestEntry } from "./GuestEntry";

type FakeResponse = { status?: number; json?: unknown };

type Call = { method: string; path: string; body: Record<string, unknown> | null };

const installFetch = (respond: (method: string, path: string) => FakeResponse) => {
  const calls: Call[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), "http://localhost").pathname;
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, path, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
    const out = respond(method, path);
    return new Response(JSON.stringify(out.json ?? { ok: true }), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = previous; } };
};

const unauthorized: FakeResponse = { status: 401, json: { ok: false, error: { kind: "unauthorized" } } };
const publicConfig: FakeResponse = { json: { turnstileSiteKey: "site-key-test", vapidPublicKey: "v", contactEmail: null } };
/** 取得の画面を出すホーム（客は登録済み）。 */
const homeFetch: FakeResponse = { json: { kind: "fetch", profile: { nickname: "guest-abc123", phone: "0000000000", genres: [], budgetMax: null } } };

/** Turnstile の代わり（実物と同じ形で、描かれた瞬間に値を1つ渡す）。 */
type TurnstileWindow = Window & {
  turnstile?: { render: (el: HTMLElement, opts: { callback: (token: string) => void }) => string; reset: () => void };
};
const installTurnstile = () => {
  (window as TurnstileWindow).turnstile = {
    render: (_el, opts) => {
      opts.callback("tok-auto");
      return "widget-1";
    },
    reset: () => {},
  };
};

const registerCalls = (calls: Call[]): Call[] => calls.filter((c) => c.method === "POST" && c.path === "/api/register/customer");

describe("客の画面の入口（登録を客に見せない）", () => {
  let fake: ReturnType<typeof installFetch> | null = null;

  afterEach(() => {
    cleanup();
    fake?.restore();
    fake = null;
    delete (window as TurnstileWindow).turnstile;
  });

  it("識別子が無ければ、客に何も聞かずに登録を送る。呼び名は自動で作り、電話番号は形だけの仮の値", async () => {
    installTurnstile();
    let registered = false;
    fake = installFetch((method, path) => {
      if (path === "/api/config/public") return publicConfig;
      if (path === "/api/customer/home") return registered ? homeFetch : unauthorized;
      if (method === "POST" && path === "/api/register/customer") {
        registered = true;
        return { status: 201, json: { ok: true } };
      }
      return { status: 404, json: { ok: false } };
    });

    render(<GuestEntry />);
    await waitFor(() => expect(registerCalls(fake!.calls)).toHaveLength(1));

    const sent = registerCalls(fake!.calls)[0].body!;
    const nickname = String(sent.nickname);
    expect(nickname).toMatch(/^guest-[0-9a-z]{1,10}$/);
    // 呼び名の上限は schemas/limits.ts の NICKNAME_MAX（20字）
    expect(nickname.length).toBeLessThanOrEqual(20);
    // 形の正本は schemas/limits.ts の PHONE_PATTERN（0 で始まる10〜11桁）
    expect(String(sent.phone)).toMatch(/^0\d{9,10}$/);
    expect(sent.genres).toEqual([]);
    expect(sent.budgetMax).toBeNull();
    expect(sent.humanToken).toBe("tok-auto");
  });

  it("登録が通れば、客が見るのは取得の画面（登録の入力は出ない）", async () => {
    installTurnstile();
    let registered = false;
    fake = installFetch((method, path) => {
      if (path === "/api/config/public") return publicConfig;
      if (path === "/api/customer/home") return registered ? homeFetch : unauthorized;
      if (method === "POST" && path === "/api/register/customer") {
        registered = true;
        return { status: 201, json: { ok: true } };
      }
      return { status: 404, json: { ok: false } };
    });

    render(<GuestEntry />);
    await screen.findByTestId("btn-fetch");
    expect(screen.queryByTestId("field-nickname")).toBeNull();
    expect(screen.queryByTestId("form-register")).toBeNull();
  });

  it("登録が断られたら、手で入れる登録の入力へ倒れる（受け皿）", async () => {
    installTurnstile();
    fake = installFetch((method, path) => {
      if (path === "/api/config/public") return publicConfig;
      if (path === "/api/customer/home") return unauthorized;
      if (method === "POST" && path === "/api/register/customer") return { status: 400, json: { ok: false, error: { kind: "human_check_failed" } } };
      return { status: 404, json: { ok: false } };
    });

    render(<GuestEntry />);
    await screen.findByTestId("field-nickname");
    expect(screen.queryByTestId("btn-fetch")).toBeNull();
  });

  it("既に識別子を持っていれば、登録は送らずそのまま取得の画面を出す", async () => {
    installTurnstile();
    fake = installFetch((_method, path) => {
      if (path === "/api/config/public") return publicConfig;
      if (path === "/api/customer/home") return homeFetch;
      return { status: 404, json: { ok: false } };
    });

    render(<GuestEntry />);
    await screen.findByTestId("btn-fetch");
    expect(registerCalls(fake!.calls)).toHaveLength(0);
  });
});
