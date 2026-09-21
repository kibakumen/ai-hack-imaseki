// @vitest-environment jsdom
// 要件26（画面）: 26.1・26.14 通報ボタンと入口、26.3 の断りの表示、26.5 送れた文、26.13・26.16・26.17 最近行った店、26.19 断られた文。
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { componentOf, homeFetch, installFakeApi, invalidInput, loadWeb, refusal, reservationDto, type FakeApi } from "./_fakes";
import { TID, type HomeDto } from "./_types";

describeTask("23", "通報の入口と最近行った店（画面）", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
  });

  const renderApp = async (home: HomeDto, routes: Record<string, any> = {}) => {
    api = installFakeApi({ "GET /api/config/public": () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } }), "GET /api/customer/home": () => ({ json: home }), "GET /api/customer/recent": () => ({ json: { items: [] } }), ...routes });
    const CustomerApp = await componentOf("components/customer/CustomerApp", "CustomerApp");
    render(<CustomerApp />);
  };

  it("26.1・26.14 確保中と完了済みの表示に通報ボタンが在り、取得の画面・確保中・完了済みのそれぞれに「最近行った店」の入口が在る", async () => {
    for (const kind of ["active", "completed"] as const) {
      await renderApp({ ...homeFetch(), kind, reservation: reservationDto({ status: kind }) });
      const view = await screen.findByTestId(TID.view(kind));
      expect(within(view).getByTestId(TID.btn("report"))).toBeTruthy();
      expect(screen.getByTestId(TID.btn("recent"))).toBeTruthy();
      cleanup();
      api.restore();
    }
    await renderApp(homeFetch());
    await screen.findByTestId(TID.btn("fetch"));
    expect(screen.getByTestId(TID.btn("recent"))).toBeTruthy();
  });

  it("26.3・26.5・26.19 理由の欄の直下に文が出て書いた理由が残る（required・too_long で文が違う）。report_not_allowed は「送る」の直下。通ると送れたことの文", async () => {
    const { TEXTS } = await loadWeb("lib/domain/texts");
    let response: any = invalidInput([{ name: "reason", reason: "required" }]);
    await renderApp({ ...homeFetch(), kind: "active", reservation: reservationDto() }, { "POST /api/customer/reports": ({ body }) => (expect(body.storeId).toBe("store-1"), response) });
    fireEvent.click(within(await screen.findByTestId(TID.view("active"))).getByTestId(TID.btn("report")));
    const form = await screen.findByTestId(TID.form("report"));
    fireEvent.click(within(form).getByTestId(TID.btn("send-report")));
    await waitFor(() => expect(within(form).getByTestId(TID.msg("reason"))).toBeTruthy());
    const required = within(form).getByTestId(TID.msg("reason")).textContent;
    fireEvent.change(within(form).getByTestId(TID.field("reason")), { target: { value: "長い理由" } });
    response = invalidInput([{ name: "reason", reason: "too_long" }]);
    fireEvent.click(within(form).getByTestId(TID.btn("send-report")));
    await waitFor(() => expect(within(form).getByTestId(TID.msg("reason")).textContent).not.toBe(required));
    expect(within(form).getByTestId(TID.msg("reason")).textContent).toMatch(/500/);
    expect((within(form).getByTestId(TID.field("reason")) as HTMLTextAreaElement).value).toBe("長い理由");
    response = refusal("report_not_allowed");
    fireEvent.click(within(form).getByTestId(TID.btn("send-report")));
    await waitFor(() => expect(within(form).getByTestId(TID.msgForm).textContent).toBe(TEXTS.inputRefusal("report_not_allowed")));
    await waitFor(() => expect(within(form).queryByTestId(TID.msg("reason"))).toBeNull());
    response = { status: 201, json: { ok: true } };
    fireEvent.click(within(form).getByTestId(TID.btn("send-report")));
    await screen.findByTestId("report-sent");
  });

  it("26.13・26.16・26.17 最近行った店: 0件の文。行に店名・日時・通報ボタンだけで、コード・住所・URL が無い。行の通報はその店を指す", async () => {
    let items: any[] = [];
    await renderApp(homeFetch(), { "GET /api/customer/recent": () => ({ json: { items } }), "POST /api/customer/reports": () => ({ status: 201, json: { ok: true } }) });
    await screen.findByTestId(TID.btn("fetch"));
    fireEvent.click(screen.getByTestId(TID.btn("recent")));
    await screen.findByTestId("recent-empty");
    cleanup();
    api.restore();
    items = [{ reservationId: "res-9", storeId: "store-9", storeName: "先週の店", completedAt: "2026-09-20T10:30:00.000Z" }];
    await renderApp(homeFetch(), { "GET /api/customer/recent": () => ({ json: { items } }), "POST /api/customer/reports": () => ({ status: 201, json: { ok: true } }) });
    await screen.findByTestId(TID.btn("fetch"));
    fireEvent.click(screen.getByTestId(TID.btn("recent")));
    const row = await screen.findByTestId(TID.row("res-9"));
    expect(row.textContent).toContain("先週の店");
    expect(row.textContent).toMatch(/9\/20|09-20|20日/);
    expect(row.textContent).not.toMatch(/\d{8}/);
    expect(row.querySelector("a[href^='http']")).toBeNull();
    expect(row.textContent).not.toMatch(/東京都|区/);
    fireEvent.click(within(row).getByTestId(TID.btn("report")));
    const form = await screen.findByTestId(TID.form("report"));
    fireEvent.change(within(form).getByTestId(TID.field("reason")), { target: { value: "理由" } });
    fireEvent.click(within(form).getByTestId(TID.btn("send-report")));
    await waitFor(() => expect(api.calls.find((c) => c.path === "/api/customer/reports")!.body.storeId).toBe("store-9"));
  });
});
