// @vitest-environment jsdom
// 運営の画面: 24.7（タスク8）、25.2・25.3・25.5（タスク8）、26.7・26.9（タスク23）、33.4（タスク24）、モデル別の表（タスク28）。
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { componentOf, installFakeApi, refusal, unauthorized, type FakeApi } from "./_fakes";
import { TID } from "./_types";

// 2026-09-25 監査の指摘（運営-01〜運営-05・横断-09）で詳細の応答に足した項目（判断材料・写し・履歴）も揃えた形。
const storeDetail = (over: Record<string, unknown> = {}) => ({
  json: {
    store: {
      id: "store-1",
      name: "検査の店",
      address: "東京都渋谷区1-1",
      email: "s@example.com",
      status: "pending",
      publishing: false,
      createdAt: "2026-09-01T00:00:00.000Z",
      claims: 0,
      offerRemaining: null,
      genres: ["和食"],
      menus: ["刺身"],
      budgetMin: 1000,
      budgetMax: 3000,
      url: null,
      license: true,
      cardRegistered: true,
      changedSinceApproval: false,
      contacted: false,
      storeCancelled: 0,
      storeCancelRate: 0,
      licenseUploadedAt: null,
      approval: null,
      changes: { name: false, address: false, license: false },
      activeReservations: 0,
      duplicates: 0,
      note: null,
      contactedAt: null,
      ...over,
    },
    reports: { count: 0, latest: [] },
    history: [],
  },
});

/** 一覧の1行（2026-09-25 の監査の指摘で足した項目つき） */
const listRow = (over: Record<string, unknown> = {}) => ({
  publishing: false,
  createdAt: "2026-09-01T00:00:00.000Z",
  claims: 0,
  budgetMin: null,
  offerRemaining: null,
  changedSinceApproval: false,
  contacted: false,
  storeCancelled: 0,
  storeCancelRate: 0,
  ...over,
});

const SUMMARY = { publishing: 0, pending: 0, awaiting: 0, total: 0 };

describeTask("8", "店の一覧と詳細の画面", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
  });

  it("24.7 当たる店が無いことの文が出る。店があれば出ない", async () => {
    let items: any[] = [];
    api = installFakeApi({ "GET /api/admin/stores": () => ({ json: { items, summary: { ...SUMMARY, total: items.length } } }) });
    const StoreList = await componentOf("components/admin/StoreList", "StoreList");
    render(<StoreList />);
    await screen.findByTestId("stores-empty");
    cleanup();
    items = [listRow({ id: "s1", name: "店A", address: "住所A", email: "a@example.com", status: "approved" })];
    render(<StoreList />);
    await screen.findByText("店A");
    expect(screen.queryByTestId("stores-empty")).toBeNull();
  });

  it("25.2 足りないものがあると「承認する」が押せず足りないものが出る。揃っていれば押せる。25.3 承認を断る操作が無い", async () => {
    let detail = storeDetail({ license: false, cardRegistered: true });
    api = installFakeApi({ "GET /api/admin/stores/:id": () => detail });
    const StoreDetail = await componentOf("components/admin/StoreDetail", "StoreDetail");
    const { container } = render(<StoreDetail storeId="store-1" />);
    const approve = (await screen.findByTestId(TID.btn("approve"))) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    expect(screen.getByTestId("approval-missing").textContent).toMatch(/営業許可書/);
    expect(screen.getByTestId("approval-missing").textContent).not.toMatch(/カード/);
    expect(container.textContent).not.toMatch(/承認を断る|却下|拒否/);
    expect(screen.queryByTestId(TID.btn("reject"))).toBeNull();
    cleanup();
    detail = storeDetail({ license: true, cardRegistered: true });
    render(<StoreDetail storeId="store-1" />);
    expect(((await screen.findByTestId(TID.btn("approve"))) as HTMLButtonElement).disabled).toBe(false);
  });

  it("25.2（画面）approval_missing の応答で「承認する」の直下に文が出て、詳細の画面のまま", async () => {
    api = installFakeApi({ "GET /api/admin/stores/:id": () => storeDetail(), "POST /api/admin/stores/:id/approve": () => refusal("approval_missing", { fields: [{ name: "license", reason: "required" }, { name: "card", reason: "required" }] }) });
    const StoreDetail = await componentOf("components/admin/StoreDetail", "StoreDetail");
    render(<StoreDetail storeId="store-1" />);
    fireEvent.click(await screen.findByTestId(TID.btn("approve")));
    const form = screen.getByTestId(TID.form("approve"));
    await waitFor(() => expect(form.querySelector(`[data-testid="${TID.msgForm}"]`)).toBeTruthy());
    expect(screen.getByText("検査の店")).toBeTruthy();
  });

  // 2026-09-25 運営-01: 取り消しには理由を入れてから確かめる（理由を入れるまで押せない）。応答は取り消した組数と通知した人数つき（運営-03）。
  it("25.5 止める前に、公開中のオファーが終わり確保が取り消されることの確かめが出て、確かめてから止める要求が出る", async () => {
    api = installFakeApi({ "GET /api/admin/stores/:id": () => storeDetail({ status: "approved" }), "POST /api/admin/stores/:id/ban": () => ({ json: { ok: true, cancelled: 0, notified: 0 } }) });
    const StoreDetail = await componentOf("components/admin/StoreDetail", "StoreDetail");
    render(<StoreDetail storeId="store-1" />);
    fireEvent.click(await screen.findByTestId(TID.btn("ban")));
    expect(api.calls.filter((c) => c.path.endsWith("/ban"))).toHaveLength(0);
    const confirm = await screen.findByTestId("confirm-ban");
    expect(confirm.textContent).toMatch(/オファー/);
    expect(confirm.textContent).toMatch(/確保/);
    expect(confirm.textContent).toMatch(/確保[^。]*キャンセルされ/);
    fireEvent.change(within(confirm).getByTestId("field-reason"), { target: { value: "通報が続いたため" } });
    fireEvent.click(within(confirm).getByTestId(TID.btn("confirm")));
    await waitFor(() => expect(api.calls.filter((c) => c.path.endsWith("/ban"))).toHaveLength(1));
  });
});

describeTask("23", "通報の一覧の画面", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
  });

  it("26.9 通報が無いことの文。26.7 行から店の詳細へ移れる（店の識別子へのリンク）。26.8 電話番号と呼び名が出ない", async () => {
    let items: any[] = [];
    api = installFakeApi({ "GET /api/admin/reports": () => ({ json: { items } }) });
    const ReportList = await componentOf("components/admin/ReportList", "ReportList");
    render(<ReportList />);
    await screen.findByTestId("reports-empty");
    cleanup();
    items = [{ id: "r1", storeId: "store-9", storeName: "通報された店", reason: "来たら閉まっていた", at: "2026-09-22T06:00:00.000Z", reporter: "a1b2c3", storeReportCount: 1 }];
    const { container } = render(<ReportList />);
    await screen.findByText("通報された店");
    expect(screen.queryByTestId("reports-empty")).toBeNull();
    const link = container.querySelector("a[href*='store-9']");
    expect(link).toBeTruthy();
    expect(container.textContent).toContain("来たら閉まっていた");
  });
});

describeTask("24", "運営の数字の画面", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
  });

  it("33.4 数字（AI の実費・所要時間・成否、取得の所要時間、AI を使った／倒れた、自動で取り消された割合）が出て、値を変えると表示が変わる", async () => {
    // 2026-09-25 運営-08・不具合-10 で足した項目（数えた時刻・実費の合計・候補0件・割合）も揃えた形
    const metrics = (expiredRate: number) => ({
      json: {
        at: "2026-09-22T06:00:00.000Z",
        cost: { totalUsd: 0.0144, totalCalls: 12, todayUsd: 0.0144, todayCalls: 12 },
        ai: { calls: 12, avgCostUsd: 0.0012, avgDurationMs: 1500, succeeded: 11, failed: 1 },
        fetch: { count: 20, avgDurationMs: 2200, aiUsed: 18, fellBack: 2, noCandidates: 0, fellBackRate: 0.1 },
        reservations: { total: 10, expiredRate },
        byModel: [],
        fallbackCount: 0,
        fallbackRate: 0,
      },
    });
    let rate = 0.3;
    api = installFakeApi({ "GET /api/admin/metrics": () => metrics(rate) });
    const Metrics = await componentOf("components/admin/Metrics", "Metrics");
    const { container } = render(<Metrics />);
    await screen.findByTestId("metrics");
    expect(container.textContent).toMatch(/30\s*%/);
    expect(container.textContent).toMatch(/18/);
    expect(container.textContent).toMatch(/2200|2\.2/);
    cleanup();
    rate = 0.45;
    render(<Metrics />);
    await screen.findByTestId("metrics");
    expect(container.textContent).not.toMatch(/30\s*%/);
    expect(screen.getByTestId("metrics").textContent).toMatch(/45\s*%/);
  });
});

describeTask("28", "モデル別の表（第4周の追記）", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
  });

  it("行ごとの件数・平均実費・平均所要時間・検査落ち率・倒れた率と、受け皿が答えた件数が出る", async () => {
    api = installFakeApi({
      "GET /api/admin/metrics": () => ({
        json: {
          at: "2026-09-22T06:00:00.000Z",
          cost: { totalUsd: 0.005, totalCalls: 5, todayUsd: 0.005, todayCalls: 5 },
          ai: { calls: 5, avgCostUsd: 0.001, avgDurationMs: 1000, succeeded: 5, failed: 0 },
          fetch: { count: 5, avgDurationMs: 2000, aiUsed: 4, fellBack: 1, noCandidates: 0, fellBackRate: 0.2 },
          reservations: { total: 1, expiredRate: 0 },
          byModel: [
            { model: "openai/gpt-4o-mini", count: 3, avgCostUsd: 0.0011, avgDurationMs: 900, validationFailedRate: 0.3333, fellBackRate: 0.3333 },
            { model: "anthropic/claude-haiku-4.5", count: 1, avgCostUsd: 0.002, avgDurationMs: 1400, validationFailedRate: 0, fellBackRate: 0 },
            { model: null, count: 1, avgCostUsd: null, avgDurationMs: 800, validationFailedRate: 0, fellBackRate: 1 },
          ],
          fallbackCount: 1,
          fallbackRate: 0.2,
        },
      }),
    });
    const Metrics = await componentOf("components/admin/Metrics", "Metrics");
    render(<Metrics />);
    const table = await screen.findByTestId("by-model");
    expect(within(table).getAllByRole("row").length).toBeGreaterThanOrEqual(4);
    expect(table.textContent).toContain("openai/gpt-4o-mini");
    expect(table.textContent).toContain("anthropic/claude-haiku-4.5");
    expect(table.textContent).toMatch(/不明/);
    expect(table.textContent).toMatch(/33\s*%/);
    expect(screen.getByTestId("fallback-count").textContent).toMatch(/1/);
  });

  // 横断-01 で直した: /login への道は運営の画面の殻（app/admin/layout の SessionExpiredNotice）が出すので、殻ごと描く。
  it("運営の店の一覧を開いてログインが切れていたら（401）、ログインへ戻る道が出る（横断-01）", async () => {
    api = installFakeApi({ "GET /api/admin/stores": unauthorized });
    const AdminLayout = await componentOf("app/admin/layout", "AdminLayout");
    const StoreList = await componentOf("components/admin/StoreList", "StoreList");
    const { container } = render(
      <AdminLayout>
        <StoreList />
      </AdminLayout>,
    );
    await waitFor(() => expect(container.querySelector('a[href^="/login"]')).toBeTruthy(), { timeout: 2_000 });
  });
});

