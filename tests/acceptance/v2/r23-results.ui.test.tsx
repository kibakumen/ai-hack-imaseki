// @vitest-environment jsdom
// 要件23（画面）: 23.1・23.6 1画面に4つの数と内訳、23.8 0件の文。店-13（2026-09-25）: 各行の条件と割合、今日と直近7日の合計。
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
    const zero = { offers: 0, shown: 0, received: 0, completed: 0, cancelled: 0 };
    let summary: any = { today: zero, week: zero };
    api = installFakeApi({ "GET /api/store/results": () => ({ json: { items, summary } }) });
    const ResultsTable = await componentOf("components/store/ResultsTable", "ResultsTable");
    render(<ResultsTable />);
    await screen.findByTestId("results-empty");
    cleanup();
    items = [
      {
        offerId: "o1",
        publishedAt: "2026-09-22T06:00:00.000Z",
        shown: 6,
        received: 5,
        completed: 2,
        cancelled: { total: 3, customer: 1, expired: 1, store: 1, admin: 0 },
        // 店-13（2026-09-25）: そのオファーの条件と終わった理由
        capacity: 7,
        initialCapacity: 5,
        partyMax: 4,
        untilAt: "2026-09-22T13:30:00.000Z",
        untilSet: true,
        endedAt: "2026-09-22T09:00:00.000Z",
        endReason: "stopped",
        coupons: ["生ビール"],
        couponCount: 1,
      },
    ];
    summary = { today: { offers: 1, shown: 6, received: 5, completed: 2, cancelled: 3 }, week: { offers: 4, shown: 20, received: 10, completed: 5, cancelled: 5 } };
    render(<ResultsTable />);
    const row = await screen.findByTestId("row-o1");
    expect(screen.queryByTestId("results-empty")).toBeNull();
    for (const n of ["6", "5", "2", "3"]) expect(row.textContent).toContain(n);
    expect(row.textContent).toMatch(/客/);
    expect(row.textContent).toMatch(/期限/);
    expect(row.textContent).toMatch(/店/);
    expect(row.textContent).toMatch(/運営/);
    // 店-13: 条件（配信数・何名まで・時刻・クーポン・終わった理由）と割合
    expect(row.textContent).toMatch(/5組/);
    expect(row.textContent).toMatch(/4名まで/);
    expect(row.textContent).toMatch(/15:00/);
    expect(row.textContent).toMatch(/18:00/);
    expect(row.textContent).toContain("生ビール");
    expect(row.textContent).toMatch(/止めた/);
    expect(row.textContent).toMatch(/83%/);
    expect(row.textContent).toMatch(/40%/);
    const totals = screen.getByTestId("results-summary");
    expect(totals.textContent).toMatch(/今日/);
    expect(totals.textContent).toMatch(/直近7日/);
    expect(totals.textContent).toContain("20");
  });
});
