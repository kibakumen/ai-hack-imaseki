// @vitest-environment jsdom
// 運営の通報の一覧（2026-09-25 監査の指摘 運営-09・運営-12）。
import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { installFakeApi, type FakeApi } from "../../../tests/acceptance/v2/_fakes";
import { ReportList } from "./ReportList";

let api: FakeApi | null = null;
afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
});

const report = (over: Record<string, unknown> = {}) => ({
  id: "r1",
  storeId: "store-9",
  storeName: "通報された店",
  reason: "来たら閉まっていた",
  at: "2026-09-22T06:00:00.000Z",
  reporter: "a1b2c3",
  storeReportCount: 3,
  ...over,
});

describe("通報の一覧", () => {
  it("読み込み中は「読み込んでいます」を出す（本文を空にしない）", async () => {
    api = installFakeApi({ "GET /api/admin/reports": () => new Promise(() => {}) });
    render(<ReportList />);
    expect((await screen.findByTestId("load-loading")).textContent).toMatch(/読み込んでいます/);
  });

  it("行ごとに、通報した人の印と、その店への通報の数が出る。同じ印の行は同じ人（運営-09）", async () => {
    api = installFakeApi({
      "GET /api/admin/reports": () => ({ json: { items: [report(), report({ id: "r2", reason: "2回目", storeReportCount: 3 }), report({ id: "r3", reporter: "ffeedd", storeId: "store-8", storeName: "別の店", storeReportCount: 1 })] } }),
    });
    render(<ReportList />);
    const first = await screen.findByTestId("row-r1");
    expect(first.textContent).toMatch(/a1b2c3/);
    expect(first.textContent).toMatch(/この店への通報 3 件/);
    expect(screen.getByTestId("row-r3").textContent).toMatch(/ffeedd/);
  });

  it("1件ずつカードの面で区切る（ほかの運営の画面と同じ見た目・運営-12）", async () => {
    api = installFakeApi({ "GET /api/admin/reports": () => ({ json: { items: [report()] } }) });
    render(<ReportList />);
    const row = await screen.findByTestId("row-r1");
    expect(row.className).not.toBe("");
    expect(within(row).getByText("来たら閉まっていた").className).not.toBe("");
  });
});
