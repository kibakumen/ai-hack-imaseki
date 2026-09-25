// @vitest-environment jsdom
// 予算の上限を押して選ぶチップ（2026-09-25 監査の指摘 客-15 の案A・本人の第1回の指摘「予算も専用のフォームが
// あった方が入力しやすい」）。以前は素の数値欄で、単位の「円」もよく使う額の選択肢も無かった。
//
// 見るのは3つ:
//   1. 「指定なし／〜1,000円／〜2,000円／〜3,000円／〜5,000円」が並び、登録の値が初めから選ばれている
//      （登録の値が選択肢に無ければ、その額のチップを足して選んでおく）
//   2. 押したチップの額がその回の取得に載る
//   3. 「指定なし」は上限なし（null）

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchForm } from "./FetchForm";
import { replyToResponse, streamOfResult } from "../../../tests/acceptance/v2/_fakes";

vi.mock("../../lib/client/geolocation", () => ({
  currentLocation: async () => ({ ok: false, error: { kind: "location_required", fields: [{ name: "place", reason: "required" }] } }),
}));

type Call = { method: string; path: string; body: Record<string, unknown> | null };

const installFetch = () => {
  const calls: Call[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, path: url.pathname, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
    if (method === "POST" && url.pathname === "/api/customer/fetch/stream") return replyToResponse({ stream: streamOfResult({ fetchId: "f1", items: [] }) });
    return replyToResponse({ status: 404, json: { ok: false } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = previous; } };
};

const fetchBodies = (calls: Call[]) => calls.filter((c) => c.method === "POST" && c.path === "/api/customer/fetch/stream").map((c) => c.body ?? {});

describe("予算の上限のチップ", () => {
  let fake: ReturnType<typeof installFetch> | null = null;
  afterEach(() => {
    cleanup();
    fake?.restore();
    fake = null;
  });

  const renderForm = (budgetMax: number | null) => {
    fake = installFetch();
    render(<FetchForm profile={{ nickname: "guest-a", phone: "0000000000", genres: [], budgetMax }} party="2" onPartyChange={vi.fn()} onResults={vi.fn()} />);
    fireEvent.change(screen.getByTestId("field-place"), { target: { value: "渋谷" } });
    return screen.getByTestId("field-budgetMax");
  };

  const chip = (field: HTMLElement, key: string) => within(field).getByTestId(`budget-${key}`) as HTMLInputElement;

  it("よく使う額が円つきで並び、登録の値が初めから選ばれている。選択肢に無い登録の値はそのチップを足す", () => {
    const field = renderForm(4000);
    const labels = [...field.querySelectorAll("label")].map((l) => l.textContent);
    expect(labels).toEqual(["指定なし", "〜1,000円", "〜2,000円", "〜3,000円", "〜4,000円", "〜5,000円"]);
    expect(chip(field, "4000").checked).toBe(true);
    expect(field.querySelectorAll('input[type="number"]')).toHaveLength(0);
  });

  it("押したチップの額がその回の取得に載り、「指定なし」は上限なし", async () => {
    const field = renderForm(null);
    expect(chip(field, "none").checked).toBe(true);
    fireEvent.click(chip(field, "2000"));
    fireEvent.click(screen.getByTestId("btn-fetch"));
    await waitFor(() => expect(fetchBodies(fake!.calls)).toHaveLength(1));
    expect(fetchBodies(fake!.calls)[0].budgetMax).toBe(2000);

    await waitFor(() => expect((screen.getByTestId("btn-fetch") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(chip(field, "none"));
    fireEvent.click(screen.getByTestId("btn-fetch"));
    await waitFor(() => expect(fetchBodies(fake!.calls)).toHaveLength(2));
    expect(fetchBodies(fake!.calls)[1].budgetMax).toBeNull();
  });
});
