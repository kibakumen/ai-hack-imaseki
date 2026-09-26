// @vitest-environment jsdom
// 運営の数字の画面（2026-09-25 監査の指摘 運営-08・不具合-10）。
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { installFakeApi, type FakeApi } from "../../../tests/acceptance/v2/_fakes";
import { Metrics } from "./Metrics";

let api: FakeApi | null = null;
afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
});

const metrics = (over: Record<string, unknown> = {}) => ({
  at: "2026-09-22T06:05:00.000Z",
  cost: { totalUsd: 1.2345, totalCalls: 900, todayUsd: 0.4321, todayCalls: 120 },
  ai: { calls: 300, avgCostUsd: 0.0012, avgDurationMs: 1500, succeeded: 290, failed: 10 },
  fetch: { count: 320, avgDurationMs: 2200, aiUsed: 290, fellBack: 10, noCandidates: 20, fellBackRate: 10 / 300 },
  reservations: { total: 50, expiredRate: 0.1 },
  byModel: [],
  byPurpose: [],
  fallbackCount: 9,
  fallbackRate: 0.01,
  ...over,
});

describe("数字の画面", () => {
  it("いちばん上に今日（日本時間）と全期間の AI の実費の合計が出て、いつの時点の数かと読み直すボタンがある", async () => {
    let calls = 0;
    api = installFakeApi({ "GET /api/admin/metrics": () => ({ json: metrics({ at: calls++ === 0 ? "2026-09-22T06:05:00.000Z" : "2026-09-22T06:30:00.000Z" }) }) });
    render(<Metrics />);
    const totals = await screen.findByTestId("cost-totals");
    expect(totals.textContent).toMatch(/\$0\.4321/);
    expect(totals.textContent).toMatch(/120 回/);
    expect(totals.textContent).toMatch(/\$1\.2345/);
    expect(screen.getByTestId("metrics-at").textContent).toMatch(/15:05 の時点/);
    fireEvent.click(screen.getByTestId("btn-reload-metrics"));
    await waitFor(() => expect(screen.getByTestId("metrics-at").textContent).toMatch(/15:30 の時点/));
  });

  it("候補0件の取得は「点数順」とは別の行で出し、設計書どおり割合も出す。内部の言い方（倒れた・受け皿）を出さない", async () => {
    api = installFakeApi({ "GET /api/admin/metrics": () => ({ json: metrics() }) });
    const { container } = render(<Metrics />);
    const grid = await screen.findByTestId("metrics");
    expect(grid.textContent).toMatch(/候補が無く AI を呼ばなかった取得/);
    expect(grid.textContent).toMatch(/20 回/);
    expect(grid.textContent).toMatch(/3%/);
    expect(container.textContent).not.toMatch(/倒れた|受け皿/);
  });

  // 2026-09-26 本人選択: 退会の巻き添えで取り消した確保は、店の取り消しに混ぜず「退会でキャンセル」として分けて出す
  it("退会でキャンセルした確保を、店のキャンセルとは別の行で出す", async () => {
    api = installFakeApi({ "GET /api/admin/metrics": () => ({ json: metrics({ storeCancels: { total: 4, noShow: 1, withdrawn: 3 } }) }) });
    render(<Metrics />);
    const grid = await screen.findByTestId("metrics");
    const row = [...grid.querySelectorAll("dt")].find((dt) => dt.textContent === "退会でキャンセルした確保");
    expect(row?.nextElementSibling?.textContent).toContain("3 件");
  });

  it("各数字に1行の説明が付く", async () => {
    api = installFakeApi({ "GET /api/admin/metrics": () => ({ json: metrics() }) });
    render(<Metrics />);
    const grid = await screen.findByTestId("metrics");
    const descriptions = grid.querySelectorAll("[data-testid='metric-help']");
    expect(descriptions.length).toBe(grid.querySelectorAll("dt").length);
  });

  // 2026-09-26 本人選択（AI提示）: 効果を示す数字は「来店した割合（確保のうち完了済み）」。数字の画面の最上段に置く（要件33）
  it("最上段（実費の合計より上）に、来店した割合と、その件数（完了済み／終わった確保）が出る", async () => {
    api = installFakeApi({ "GET /api/admin/metrics": () => ({ json: metrics({ visits: { completed: 12, settled: 40, rate: 0.3 } }) }) });
    render(<Metrics />);
    const visit = await screen.findByTestId("visit-rate");
    expect(visit.textContent).toMatch(/来店した割合/);
    expect(visit.textContent).toMatch(/30%/);
    expect(visit.textContent).toMatch(/12/);
    expect(visit.textContent).toMatch(/40/);
    const totals = screen.getByTestId("cost-totals");
    expect(visit.compareDocumentPosition(totals) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const main = screen.getByRole("main");
    const firstBlock = [...main.children].find((child) => child.tagName !== "H1" && child.getAttribute("data-testid") !== null && child.getAttribute("data-testid") !== "metrics-toolbar");
    expect(firstBlock?.getAttribute("data-testid")).toBe("visit-rate");
  });
});
