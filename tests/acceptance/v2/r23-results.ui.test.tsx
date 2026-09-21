// @vitest-environment jsdom
// 要件23（画面）: 23.1・23.6 1画面に4つの数と内訳、23.8 0件の文。
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { componentOf, installFakeApi, type FakeApi } from "./_fakes";

describeTask("22", "実績の画面", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
  });

  it("23.8 実績が無いことの文。23.1・23.6 行ごとに出た回数・受け取られた数・完了済み・取り消し（内訳つき）", async () => {
    let items: any[] = [];
    api = installFakeApi({ "GET /api/store/results": () => ({ json: { items } }) });
    const ResultsTable = await componentOf("components/store/ResultsTable", "ResultsTable");
    render(<ResultsTable />);
    await screen.findByTestId("results-empty");
    cleanup();
    items = [{ offerId: "o1", publishedAt: "2026-09-22T06:00:00.000Z", shown: 6, received: 5, completed: 2, cancelled: { total: 3, customer: 1, expired: 1, store: 1, admin: 0 } }];
    render(<ResultsTable />);
    const row = await screen.findByTestId("row-o1");
    expect(screen.queryByTestId("results-empty")).toBeNull();
    for (const n of ["6", "5", "2", "3"]) expect(row.textContent).toContain(n);
    expect(row.textContent).toMatch(/客/);
    expect(row.textContent).toMatch(/期限/);
    expect(row.textContent).toMatch(/店/);
    expect(row.textContent).toMatch(/運営/);
  });
});
