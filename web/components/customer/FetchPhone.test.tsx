// @vitest-environment jsdom
// こだわり条件の並びと、いちばん下の電話番号（任意）（2026-09-22 の本人の指摘）。
//
//   「客の最初の登録画面はいりません。こだわり条件の下に任意で電話番号を登録できるようにしといてくれたらいい」
//   「予算は好みよりも重要な情報なので、人数のすぐ下において欲しい」
//
// ⚠️ 受け入れ検査 `r03-fetch-input.ui.test.tsx` は欄の並びも電話番号の欄も見ていない（`data-testid` で
// 引くだけ）ので、並びと電話番号の振る舞いはこの検査が固定する。
//
// 見るのは5つ:
//   1. 並びは 人数 → 予算 → ジャンル → 電話番号
//   2. 登録が仮の番号（自動の登録）のままなら欄は空で見せ、本物が登録されていればそれを見せる
//   3. 入れて欄を離れると、登録の変更の入口へ4項目まとめて送る（呼び名・ジャンル・予算は登録の値）
//   4. 空のままでも「今すぐ探す」が押せ、そのときは登録の変更を送らない
//   5. 断られたら電話番号の欄の直下に文が出る

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FetchForm } from "./FetchForm";

vi.mock("../../lib/client/geolocation", () => ({
  currentLocation: async () => ({ ok: false, error: { kind: "location_required", fields: [{ name: "place", reason: "required" }] } }),
}));

type Call = { method: string; path: string; body: Record<string, unknown> | null };

const installFetch = (respond: (method: string, path: string) => { status?: number; json?: unknown }) => {
  const calls: Call[] = [];
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, path: url.pathname, body: typeof init?.body === "string" ? JSON.parse(init.body) : null });
    const out = respond(method, url.pathname);
    return new Response(JSON.stringify(out.json ?? { ok: true }), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = previous; } };
};

type Profile = { nickname: string; phone: string; genres: string[]; budgetMax: number | null };
const GUEST: Profile = { nickname: "guest-abc123", phone: "0000000000", genres: [], budgetMax: null };
const patches = (calls: Call[]) => calls.filter((c) => c.method === "PATCH" && c.path === "/api/customer/profile");
const fetches = (calls: Call[]) => calls.filter((c) => c.method === "POST" && c.path === "/api/customer/fetch");

describe("こだわり条件の並びと電話番号", () => {
  let fake: ReturnType<typeof installFetch> | null = null;

  afterEach(() => {
    cleanup();
    fake?.restore();
    fake = null;
  });

  const renderForm = (profile: Profile = GUEST, patchAnswer: { status?: number; json?: unknown } = { json: { ok: true, profile } }) => {
    fake = installFetch((method, path) => {
      if (method === "PATCH" && path === "/api/customer/profile") return patchAnswer;
      if (path === "/api/customer/fetch/stream") return { status: 404, json: { ok: false } };
      if (method === "POST" && path === "/api/customer/fetch") return { json: { ok: true, fetchId: "f1", items: [] } };
      return { status: 404, json: { ok: false } };
    });
    return render(<FetchForm profile={profile} party="2" onPartyChange={vi.fn()} onResults={vi.fn()} />);
  };

  it("並びは 人数 → 予算 → ジャンル → 電話番号。電話番号は必須でなく、電話の入力に向く属性を持つ", () => {
    const { container } = renderForm();
    const order = [...container.querySelectorAll<HTMLElement>('.fetch-options [data-testid^="field-"]')].map((el) => el.dataset.testid);
    expect(order).toEqual(["field-party", "field-budgetMax", "field-genres", "field-phone"]);

    const phone = screen.getByTestId("field-phone") as HTMLInputElement;
    expect(phone.required).toBe(false);
    expect(phone.type).toBe("tel");
    expect(phone.getAttribute("inputmode")).toBe("numeric");
    expect(phone.getAttribute("autocomplete")).toBe("tel");
    expect(container.textContent).toMatch(/緊急時に連絡/);
    expect(container.textContent).toMatch(/任意/);
  });

  it("登録が仮の番号なら欄は空。本物が登録されていればそれを見せる", () => {
    renderForm();
    expect((screen.getByTestId("field-phone") as HTMLInputElement).value).toBe("");
    cleanup();
    fake?.restore();
    renderForm({ ...GUEST, phone: "09011112222" });
    expect((screen.getByTestId("field-phone") as HTMLInputElement).value).toBe("09011112222");
  });

  it("入れて欄を離れると、登録の変更の入口へ4項目まとめて送り、通ったら「登録しました」が出る。同じ値は2度送らない", async () => {
    renderForm({ ...GUEST, genres: ["和食"], budgetMax: 3000 });
    const phone = screen.getByTestId("field-phone");
    fireEvent.change(phone, { target: { value: "09012345678" } });
    fireEvent.blur(phone);
    await waitFor(() => expect(patches(fake!.calls)).toHaveLength(1));
    expect(patches(fake!.calls)[0].body).toEqual({ nickname: "guest-abc123", phone: "09012345678", genres: ["和食"], budgetMax: 3000 });
    await screen.findByTestId("phone-saved");

    // 欄を離れた直後に「今すぐ探す」を押しても、同じ値をもう一度は送らない
    // （この場面は現在地が取れないので、場所を入れてから押す）
    fireEvent.change(screen.getByTestId("field-place"), { target: { value: "渋谷" } });
    fireEvent.click(screen.getByTestId("btn-fetch"));
    await waitFor(() => expect(fetches(fake!.calls)).toHaveLength(1));
    expect(patches(fake!.calls)).toHaveLength(1);
  });

  it("空のままでも「今すぐ探す」が押せ、そのときは登録の変更を送らない", async () => {
    renderForm();
    // この場面は現在地が取れないので、場所だけ入れて押す（電話番号は空のまま）
    fireEvent.change(screen.getByTestId("field-place"), { target: { value: "渋谷" } });
    fireEvent.click(screen.getByTestId("btn-fetch"));
    await waitFor(() => expect(fetches(fake!.calls)).toHaveLength(1));
    expect(patches(fake!.calls)).toHaveLength(0);
    expect(fetches(fake!.calls)[0].body).not.toHaveProperty("phone");
  });

  it("断られたら電話番号の欄の直下に文が出て、入れた内容は残る", async () => {
    renderForm(GUEST, { status: 400, json: { ok: false, error: { kind: "invalid_input", fields: [{ name: "phone", reason: "bad_format" }] } } });
    const phone = screen.getByTestId("field-phone") as HTMLInputElement;
    fireEvent.change(phone, { target: { value: "123" } });
    fireEvent.blur(phone);
    const msg = await screen.findByTestId("msg-phone");
    expect(msg.textContent!.length).toBeGreaterThan(0);
    expect(phone.value).toBe("123");
    expect(screen.queryByTestId("phone-saved")).toBeNull();
  });
});
