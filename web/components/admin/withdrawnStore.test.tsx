// @vitest-environment jsdom
// 運営の画面での退会した店（2026-09-26 本人発案・要件13の基準 13.20 の画面の側）。
//
// 退会した店は表の上では「登録取り消し済み」の状況のまま残る（客に出さない側へ倒すため・設計の注）が、運営の画面は
// 「退会済み」の札を出し、戻す操作を出さない（店のアカウントも許可書ももう無いので、戻しても承認できない）。

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { installFakeApi, type FakeApi } from "../../../tests/acceptance/v2/_fakes";
import { StoreCard } from "./StoreCard";
import { StoreDetail } from "./StoreDetail";

const ROW = {
  id: "store-w",
  name: "退会した店",
  address: null,
  email: null,
  status: "banned" as const,
  publishing: false,
  createdAt: "2026-09-01T00:00:00.000Z",
  claims: 3,
  budgetMin: null,
  offerRemaining: null,
  changedSinceApproval: false,
  contacted: false,
  storeCancelled: 1,
  storeCancelRate: 0.25,
  withdrawnAt: "2026-09-26T03:00:00.000Z",
};

const DETAIL = {
  ...ROW,
  url: null,
  genres: [],
  menus: [],
  budgetMax: null,
  license: false,
  cardRegistered: false,
  licenseUploadedAt: null,
  approval: null,
  changes: { name: false, address: false, license: false },
  activeReservations: 0,
  duplicates: 0,
  note: null,
  contactedAt: null,
};

let api: FakeApi | null = null;
afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
});

describe("運営の画面の退会した店", () => {
  it("一覧のカードは状況の札を「退会済み」にする", () => {
    render(
      <ul>
        <StoreCard store={ROW} sortKey="created_desc" href="/admin/stores/store-w" />
      </ul>,
    );
    const row = screen.getByTestId("row-store-w");
    expect(row.textContent).toContain("退会済み");
    expect(row.textContent).not.toContain("登録取り消し済み");
  });

  it("詳細は「退会済み」と退会の時刻を出し、戻す操作を出さない", async () => {
    api = installFakeApi({ "GET /api/admin/stores/:id": () => ({ json: { store: DETAIL, reports: { count: 0, latest: [] }, history: [] } }) });
    render(<StoreDetail storeId="store-w" />);
    const status = await screen.findByTestId("store-status");
    expect(status.textContent).toContain("退会済み");
    expect(screen.getByTestId("store-withdrawn").textContent).toMatch(/2026\/9\/26/);
    expect(screen.queryByTestId("btn-restore")).toBeNull();
  });
});
