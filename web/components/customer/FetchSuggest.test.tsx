// @vitest-environment jsdom
// 場所の欄の候補（2026-09-22 の本人の指摘「場所入力欄に渋谷駅などを打っても候補がでません。入力中の
// 文字列から Enter を押さなくても文字列に紐づいた候補が即座に出るようにしたい」）。
//
// ⚠️ 受け入れ検査 `r03-fetch-input.ui.test.tsx` は候補の入口を持たない偽物で走る（404＝候補なし）ので、
// 候補が**出ること**と**選べること**はこの検査が固定する。候補は補助なので、出なくても「今すぐ探す」が
// 押せることは r03 が既に見ている。
//
// 見るのは5つ:
//   1. 打つ手が止まって 250ms たつと候補の入口を1回だけ呼び、候補が並ぶ（最大5件）
//   2. 2文字未満では呼ばない
//   3. 行を押すと欄にその文字が入り、一覧が閉じ、そのまま探すとその文字が送られる
//   4. ↑↓ と Enter で選べ、その Enter では探さない。Esc で閉じる
//   5. 古い答えが新しい答えを上書きしない（遅く返った古い問い合わせの候補は出ない）

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FetchForm } from "./FetchForm";

/** 現在地は取れない場面にしておく（欄が自動で埋まらないので、打つ検査が素直になる） */
vi.mock("../../lib/client/geolocation", () => ({
  currentLocation: async () => ({ ok: false, error: { kind: "location_required", fields: [{ name: "place", reason: "required" }] } }),
}));

type Call = { method: string; url: URL; body: Record<string, unknown> | null };
type Answer = { status?: number; json?: unknown };

const installFetch = (respond: (method: string, url: URL) => Answer | Promise<Answer>) => {
  const calls: Call[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
    const out = await respond(method, url);
    return new Response(JSON.stringify(out.json ?? { ok: true }), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = previous; } };
};

const suggestCalls = (calls: Call[]) => calls.filter((c) => c.url.pathname === "/api/customer/place-suggest");
const fetchCalls = (calls: Call[]) => calls.filter((c) => c.method === "POST" && c.url.pathname === "/api/customer/fetch");

const SIX = ["東京都渋谷区渋谷２丁目２４ 渋谷駅", "渋谷区役所", "渋谷ヒカリエ", "渋谷スクランブルスクエア", "渋谷マークシティ", "渋谷ストリーム"];

describe("場所の欄の候補", () => {
  let fake: ReturnType<typeof installFetch> | null = null;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    cleanup();
    fake?.restore();
    fake = null;
    vi.useRealTimers();
  });

  const renderForm = (respond?: (q: string) => Answer | Promise<Answer>) => {
    fake = installFetch((method, url) => {
      if (url.pathname === "/api/customer/place-suggest") return respond ? respond(url.searchParams.get("q") ?? "") : { json: { suggestions: SIX } };
      if (url.pathname === "/api/customer/fetch/stream") return { status: 404, json: { ok: false } };
      if (method === "POST" && url.pathname === "/api/customer/fetch") return { json: { ok: true, fetchId: "f1", items: [] } };
      return { status: 404, json: { ok: false } };
    });
    render(<FetchForm party="2" onPartyChange={vi.fn()} onResults={vi.fn()} />);
    return screen.getByTestId("field-place") as HTMLInputElement;
  };

  it("打つ手が止まって 250ms たつと1回だけ呼び、候補が最大5件並ぶ", async () => {
    const field = renderForm();
    fireEvent.change(field, { target: { value: "渋" } });
    fireEvent.change(field, { target: { value: "渋谷" } });
    fireEvent.change(field, { target: { value: "渋谷駅" } });
    await vi.advanceTimersByTimeAsync(100);
    expect(suggestCalls(fake!.calls)).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(200);
    await waitFor(() => expect(suggestCalls(fake!.calls)).toHaveLength(1));
    expect(suggestCalls(fake!.calls)[0].url.searchParams.get("q")).toBe("渋谷駅");

    const items = await screen.findAllByTestId("place-suggestion");
    expect(items.map((i) => i.textContent)).toEqual(SIX.slice(0, 5));
    expect(field.getAttribute("aria-expanded")).toBe("true");
  });

  it("2文字未満では呼ばない", async () => {
    const field = renderForm();
    fireEvent.change(field, { target: { value: "渋" } });
    await vi.advanceTimersByTimeAsync(600);
    expect(suggestCalls(fake!.calls)).toHaveLength(0);
    expect(screen.queryByTestId("place-suggestions")).toBeNull();
  });

  it("行を押すと欄にその文字が入って一覧が閉じ、そのまま探すとその文字が送られる", async () => {
    const field = renderForm();
    fireEvent.change(field, { target: { value: "渋谷" } });
    await vi.advanceTimersByTimeAsync(300);
    const items = await screen.findAllByTestId("place-suggestion");

    fireEvent.click(items[1]);
    expect(field.value).toBe("渋谷区役所");
    expect(screen.queryByTestId("place-suggestions")).toBeNull();
    // 選んだ文字では聞き直さない
    await vi.advanceTimersByTimeAsync(400);
    expect(suggestCalls(fake!.calls)).toHaveLength(1);

    fireEvent.click(screen.getByTestId("btn-fetch"));
    await waitFor(() => expect(fetchCalls(fake!.calls)).toHaveLength(1));
    expect(fetchCalls(fake!.calls)[0].body?.place).toBe("渋谷区役所");
  });

  it("↑↓ と Enter で選べ、その Enter では探さない。Esc で閉じる", async () => {
    const field = renderForm();
    fireEvent.change(field, { target: { value: "渋谷" } });
    await vi.advanceTimersByTimeAsync(300);
    await screen.findAllByTestId("place-suggestion");

    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.keyDown(field, { key: "ArrowUp" });
    await waitFor(() => expect(field.getAttribute("aria-activedescendant")).toBe("fetch-place-suggestions-0"));
    fireEvent.keyDown(field, { key: "Enter" });
    expect(field.value).toBe(SIX[0]);
    expect(screen.queryByTestId("place-suggestions")).toBeNull();
    await vi.advanceTimersByTimeAsync(300);
    expect(fetchCalls(fake!.calls)).toHaveLength(0);

    fireEvent.change(field, { target: { value: "新宿" } });
    await vi.advanceTimersByTimeAsync(300);
    await screen.findAllByTestId("place-suggestion");
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByTestId("place-suggestions")).toBeNull();
    expect(field.value).toBe("新宿");
  });

  it("遅く返った古い問い合わせの候補は出ない（今の文字への答えだけを見せる）", async () => {
    let releaseOld: (() => void) | null = null;
    const field = renderForm(
      (q) =>
        q === "渋谷"
          ? new Promise<Answer>((resolve) => {
              releaseOld = () => resolve({ json: { suggestions: ["古い候補"] } });
            })
          : { json: { suggestions: ["新しい候補"] } },
    );
    fireEvent.change(field, { target: { value: "渋谷" } });
    await vi.advanceTimersByTimeAsync(300);
    await waitFor(() => expect(suggestCalls(fake!.calls)).toHaveLength(1));

    fireEvent.change(field, { target: { value: "新宿" } });
    await vi.advanceTimersByTimeAsync(300);
    const items = await screen.findAllByTestId("place-suggestion");
    expect(items.map((i) => i.textContent)).toEqual(["新しい候補"]);

    releaseOld!();
    await vi.advanceTimersByTimeAsync(50);
    expect(screen.getAllByTestId("place-suggestion").map((i) => i.textContent)).toEqual(["新しい候補"]);
  });
});
