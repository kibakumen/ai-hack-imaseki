// @vitest-environment jsdom
// 要件17（画面）: 17.6・17.9・17.11 の断りの表示、17.7・17.8・17.15・17.23、17.22 公開中のカード、18.15 直接打つ欄が無い。
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { componentOf, installFakeApi, invalidInput, offerDto, refusal, storeHomeDto, type FakeApi } from "./_fakes";
import { TID } from "./_types";

const COUPONS = [
  { id: "c1", name: "生ビール", note: "" },
  { id: "c2", name: "デザート", note: "" },
];

describeTask("9", "公開のフォームと公開中のカード", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
  });

  const renderHome = async (home: any, routes: Record<string, any> = {}) => {
    api = installFakeApi({ "GET /api/store/home": () => ({ json: home }), "GET /api/config/public": () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } }), ...routes });
    const StoreHome = await componentOf("components/store/StoreHome", "StoreHome");
    const r = render(<StoreHome />);
    await screen.findByTestId("status-banner");
    return r;
  };

  it("17.7・17.8・17.15・17.23 始まりの欄・曜日の欄・再開の操作が無い。チェック0個の間はクーポンを見せないオファーになることが出る", async () => {
    const { container } = await renderHome(storeHomeDto({ coupons: COUPONS }));
    const form = await screen.findByTestId(TID.form("publish"));
    expect(form.textContent).not.toMatch(/開始|始まり|曜日|繰り返し/);
    expect(form.querySelector("input[type='date']")).toBeNull();
    expect(container.textContent).not.toMatch(/再開/);
    expect(form.textContent).toMatch(/クーポンを見せないオファーとして公開/);
    fireEvent.click(within(form).getByTestId("coupon-c1"));
    expect(form.textContent).not.toMatch(/クーポンを見せないオファーとして公開/);
    fireEvent.click(within(form).getByTestId("coupon-c1"));
    expect(form.textContent).toMatch(/クーポンを見せないオファーとして公開/);
  });

  it("17.17 初めの値が publishPrefill から入る", async () => {
    await renderHome(storeHomeDto({ coupons: COUPONS, publishPrefill: { couponIds: ["c2"], capacity: 4, partyMax: 6, until: "21:30" } }));
    const form = await screen.findByTestId(TID.form("publish"));
    expect((within(form).getByTestId(TID.field("capacity")) as HTMLInputElement).value).toBe("4");
    expect((within(form).getByTestId(TID.field("partyMax")) as HTMLInputElement).value).toBe("6");
    expect((within(form).getByTestId(TID.field("until")) as HTMLInputElement).value).toBe("21:30");
    expect((within(form).getByTestId("coupon-c2") as HTMLInputElement).checked).toBe(true);
    expect((within(form).getByTestId("coupon-c1") as HTMLInputElement).checked).toBe(false);
  });

  it("17.6・17.9・17.11 断りの応答で、欄の直下か「公開する」の直下に文が出て、入れたチェック・組数・何名まで・何時までが残り、フォームのまま。profile_incomplete は店の情報へのリンクつき", async () => {
    let response: any = invalidInput([{ name: "capacity", reason: "out_of_range" }]);
    await renderHome(storeHomeDto({ coupons: COUPONS }), { "POST /api/store/offers": () => response });
    const form = await screen.findByTestId(TID.form("publish"));
    fireEvent.click(within(form).getByTestId("coupon-c1"));
    fireEvent.change(within(form).getByTestId(TID.field("capacity")), { target: { value: "21" } });
    fireEvent.change(within(form).getByTestId(TID.field("partyMax")), { target: { value: "4" } });
    fireEvent.change(within(form).getByTestId(TID.field("until")), { target: { value: "22:00" } });
    const publish = within(form).getByTestId(TID.btn("publish"));
    for (const [field, reason] of [["capacity", "out_of_range"], ["partyMax", "out_of_range"], ["until", "in_past"], ["until", "over_window"]] as const) {
      response = invalidInput([{ name: field, reason }]);
      fireEvent.click(publish);
      await waitFor(() => expect(within(form).getByTestId(TID.msg(field)).textContent!.length).toBeGreaterThan(0));
      for (const other of ["capacity", "partyMax", "until"].filter((f) => f !== field)) expect(within(form).queryByTestId(TID.msg(other))).toBeNull();
    }
    expect(within(form).getByTestId(TID.msg("until")).textContent).toMatch(/公開を止め|新しく公開/);
    response = refusal("offer_exists");
    fireEvent.click(publish);
    await waitFor(() => expect(within(form).getByTestId(TID.msgForm).textContent).toMatch(/終わって/));
    response = refusal("profile_incomplete", { fields: [{ name: "address", reason: "required" }] });
    fireEvent.click(publish);
    await waitFor(() => expect(within(form).getByTestId(TID.msgForm).textContent).toMatch(/住所/));
    expect(within(form).getByTestId(TID.msgForm).querySelector("a[href*='profile']")).toBeTruthy();
    expect((within(form).getByTestId(TID.field("capacity")) as HTMLInputElement).value).toBe("21");
    expect((within(form).getByTestId(TID.field("partyMax")) as HTMLInputElement).value).toBe("4");
    expect((within(form).getByTestId(TID.field("until")) as HTMLInputElement).value).toBe("22:00");
    expect((within(form).getByTestId("coupon-c1") as HTMLInputElement).checked).toBe(true);
  });

  it("17.22・18.15 公開中のカードに5項目が出て、残りやさばけた数を直接打つ欄が無い。値を変えると表示が変わる", async () => {
    for (const [capacity, remaining] of [[5, 2], [8, 0]] as const) {
      const { container } = await renderHome(storeHomeDto({ offer: offerDto({ capacity, remaining, partyMax: 6, untilAt: "2026-09-22T13:30:00.000Z", coupons: [COUPONS[0]] }) }));
      const card = await screen.findByTestId("offer-card");
      expect(card.textContent).toContain(String(capacity));
      expect(within(card).getByTestId("offer-remaining").textContent).toContain(String(remaining));
      expect(card.textContent).toContain("6");
      expect(card.textContent).toMatch(/22:30/);
      expect(card.textContent).toContain("生ビール");
      const inputs = [...container.querySelectorAll("input")].map((i) => i.getAttribute("data-testid") ?? "");
      expect(inputs.some((n) => /remaining|served|sold/.test(n))).toBe(false);
      expect(container.textContent).not.toMatch(/さばけた数を入力|残りを入力/);
      expect(screen.queryByTestId(TID.form("publish"))).toBeNull();
      cleanup();
      api.restore();
    }
  });
});
