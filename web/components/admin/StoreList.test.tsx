// @vitest-environment jsdom
// 運営の店の一覧の画面（2026-09-25 監査の指摘 運営-05・運営-06・運営-07・運営-10・運営-11・横断-09）。
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { installFakeApi, type FakeApi } from "../../../tests/acceptance/v2/_fakes";
import { StoreList } from "./StoreList";

const row = (over: Record<string, unknown> = {}) => ({
  id: "s1",
  name: "店A",
  address: "住所A",
  email: "a@example.com",
  status: "approved",
  publishing: true,
  createdAt: "2026-09-01T00:00:00.000Z",
  claims: 5,
  budgetMin: 1200,
  offerRemaining: 3,
  changedSinceApproval: false,
  contacted: false,
  storeCancelled: 0,
  storeCancelRate: 0,
  ...over,
});

let api: FakeApi | null = null;
const queries: URLSearchParams[] = [];

const install = (items: unknown[], summary: Record<string, number> = {}) => {
  queries.length = 0;
  api = installFakeApi({
    "GET /api/admin/stores": ({ url }) => {
      queries.push(url.searchParams);
      return { json: { items, summary: { publishing: 1, pending: 0, awaiting: 0, total: 12, ...summary } } };
    },
  });
};

afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
  window.history.replaceState(null, "", "/admin");
});

describe("一覧の条件を URL に載せる（運営-06）", () => {
  it("渡された条件（絞り込み・検索・並び順）で開き、その条件で一覧を取る", async () => {
    install([row()]);
    render(<StoreList initialQuery={{ filter: "pending", q: "店", sort: "claims_desc" }} />);
    await screen.findByText("店A");
    expect(queries[0].get("filter")).toBe("pending");
    expect(queries[0].get("q")).toBe("店");
    expect((screen.getByLabelText("並び替え") as HTMLSelectElement).value).toBe("claims_desc");
    expect((screen.getByTestId("field-q") as HTMLInputElement).value).toBe("店");
  });

  it("条件を変えると URL の問い合わせ文字列も変わり、詳細へのリンクがその条件を持つ", async () => {
    install([row()]);
    render(<StoreList />);
    await screen.findByText("店A");
    fireEvent.click(screen.getByTestId("filter-pending"));
    await waitFor(() => expect(window.location.search).toBe("?filter=pending"));
    fireEvent.change(screen.getByLabelText("並び替え"), { target: { value: "price_asc" } });
    await waitFor(() => expect(window.location.search).toBe("?filter=pending&sort=price_asc"));
    const link = within(await screen.findByTestId("row-s1")).getByText("店A") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/admin/stores/s1?filter=pending&sort=price_asc");
  });
});

describe("ジャンルの絞り込み（運営-07）", () => {
  it("ジャンルの札を押すと、そのジャンルで一覧を取り直す。状態の絞り込みと重ねて効く", async () => {
    install([row()]);
    render(<StoreList initialQuery={{ filter: "approved" }} />);
    await screen.findByText("店A");
    fireEvent.click(screen.getByTestId("genre-ラーメン"));
    await waitFor(() => expect(queries.at(-1)?.get("genre")).toBe("ラーメン"));
    expect(queries.at(-1)?.get("filter")).toBe("approved");
    expect(screen.getByTestId("genre-ラーメン").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByTestId("genre-all"));
    await waitFor(() => expect(queries.at(-1)?.get("genre")).toBeNull());
  });
});

describe("カードの数値の札と件数（運営-10・運営-11・運営-05・横断-09）", () => {
  it("カードに登録日・受け取り・予算・残り枠・店の取り消しの札が出て、今の並びの元の札が目立つ", async () => {
    install([row({ storeCancelled: 2, storeCancelRate: 0.4 })]);
    render(<StoreList initialQuery={{ sort: "claims_desc" }} />);
    const card = await screen.findByTestId("row-s1");
    expect(card.textContent).toMatch(/登録 2026\/9\/1/);
    expect(card.textContent).toMatch(/受け取り 5 件/);
    expect(card.textContent).toMatch(/予算 1200円〜/);
    expect(card.textContent).toMatch(/残り 3 枠/);
    expect(card.textContent).toMatch(/店の取り消し 2 回（40%）/);
    expect(within(card).getByTestId("stat-claims").getAttribute("data-active")).toBe("true");
    expect(within(card).getByTestId("stat-created").getAttribute("data-active")).toBe("false");
  });

  it("承認後に変更があった店・連絡済みの店に印が出る", async () => {
    install([row({ changedSinceApproval: true }), row({ id: "s2", name: "店B", status: "pending", contacted: true })]);
    render(<StoreList />);
    expect((await screen.findByTestId("row-s1")).textContent).toMatch(/承認後に変更あり/);
    expect(screen.getByTestId("row-s2").textContent).toMatch(/連絡済み/);
  });

  it("「全N件」は絞り込みに左右されない全店の数。一覧の中に画面のナビを重ねて出さない", async () => {
    install([row()], { total: 12 });
    const { container } = render(<StoreList initialQuery={{ filter: "approved" }} />);
    await screen.findByText("店A");
    expect(screen.getByTestId("list-count").textContent).toBe("1件表示 / 全12件");
    expect(container.querySelector("nav[aria-label='運営の画面']")).toBeNull();
  });

  it("承認待ちの強調は「連絡済み」を除いた数で、連絡済みの数も添える", async () => {
    install([row({ status: "pending" })], { pending: 3, awaiting: 1 });
    render(<StoreList />);
    const banner = await screen.findByTestId("pending-banner");
    expect(banner.textContent).toMatch(/1件/);
    expect(banner.textContent).toMatch(/連絡済み 2 件/);
  });
});
