// @vitest-environment jsdom
// 要件19（画面）: 19.2・19.5・19.9・19.12・19.13 の断りの表示、19.11 クーポンのチェックを変える操作が無い、欄の横に公開した時刻と最長の時刻。
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { componentOf, installFakeApi, invalidInput, offerDto, refusal, storeHomeDto, type FakeApi } from "./_fakes";
import { TID } from "./_types";

describeTask("20", "公開中のカードの4つの操作", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
  });

  const renderOffer = async (home: () => any, routes: Record<string, any>) => {
    api = installFakeApi({ "GET /api/store/home": () => ({ json: home() }), "GET /api/config/public": () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } }), ...routes });
    const StoreHome = await componentOf("components/store/StoreHome", "StoreHome");
    render(<StoreHome />);
    return screen.findByTestId("offer-card");
  };

  it("19.11 公開中のオファーにクーポンのチェックを変える操作が無く、「何時まで」の欄の横に公開した時刻と最長の時刻が出る", async () => {
    const card = await renderOffer(() => storeHomeDto({ offer: offerDto({ publishedAt: "2026-09-22T06:00:00.000Z", latestUntil: "2026-09-22T18:00:00.000Z", coupons: [{ id: "c1", name: "生ビール", note: "" }] }) }), {});
    expect(card.querySelectorAll("input[type='checkbox']")).toHaveLength(0);
    const untilForm = within(card).getByTestId(TID.form("until"));
    expect(untilForm.textContent).toMatch(/15:00/);
    expect(untilForm.textContent).toMatch(/03:00/);
  });

  it("断りの応答が、その操作の欄の直下かボタンの直下にだけ出て、カードの5項目と入れた数・時刻が残る。until_in_past の文に「公開を止める」、until_over_window の文に最長の時刻", async () => {
    let responses: Record<string, any> = {};
    const home = () => storeHomeDto({ offer: offerDto({ capacity: 5, remaining: 2, partyMax: 4, latestUntil: "2026-09-22T18:00:00.000Z" }), arrivals: [] });
    const card = await renderOffer(home, {
      "POST /api/store/offers/current/add": () => responses.add,
      "POST /api/store/offers/current/reduce": () => responses.reduce,
      "POST /api/store/offers/current/party-max": () => responses.partyMax,
      "POST /api/store/offers/current/until": () => responses.until,
    });
    const forms = { add: within(card).getByTestId(TID.form("add")), reduce: within(card).getByTestId(TID.form("reduce")), partyMax: within(card).getByTestId(TID.form("party-max")), until: within(card).getByTestId(TID.form("until")) };
    fireEvent.change(within(forms.add).getByTestId(TID.field("count")), { target: { value: "16" } });
    fireEvent.change(within(forms.reduce).getByTestId(TID.field("count")), { target: { value: "3" } });
    fireEvent.change(within(forms.partyMax).getByTestId(TID.field("partyMax")), { target: { value: "11" } });
    fireEvent.change(within(forms.until).getByTestId(TID.field("until")), { target: { value: "14:00" } });

    responses = { add: invalidInput([{ name: "count", reason: "over_capacity" }]) };
    fireEvent.click(within(forms.add).getByTestId(TID.btn("add")));
    await waitFor(() => expect(within(forms.add).getByTestId(TID.msg("count")).textContent).toMatch(/20/));
    expect(within(forms.reduce).queryByTestId(TID.msg("count"))).toBeNull();

    responses = { reduce: invalidInput([{ name: "count", reason: "over_remaining" }]) };
    fireEvent.click(within(forms.reduce).getByTestId(TID.btn("reduce")));
    await waitFor(() => expect(within(forms.reduce).getByTestId(TID.msg("count"))).toBeTruthy());
    const overRemaining = within(forms.reduce).getByTestId(TID.msg("count")).textContent;
    responses = { reduce: invalidInput([{ name: "count", reason: "out_of_range" }]) };
    fireEvent.click(within(forms.reduce).getByTestId(TID.btn("reduce")));
    await waitFor(() => expect(within(forms.reduce).getByTestId(TID.msg("count")).textContent).not.toBe(overRemaining));

    responses = { partyMax: invalidInput([{ name: "partyMax", reason: "out_of_range" }]) };
    fireEvent.click(within(forms.partyMax).getByTestId(TID.btn("party-max")));
    await waitFor(() => expect(within(forms.partyMax).getByTestId(TID.msg("partyMax"))).toBeTruthy());

    responses = { until: refusal("until_in_past") };
    fireEvent.click(within(forms.until).getByTestId(TID.btn("until")));
    await waitFor(() => expect(within(forms.until).getByTestId(TID.msgForm).textContent).toMatch(/公開を止める/));
    responses = { until: refusal("until_over_window") };
    fireEvent.click(within(forms.until).getByTestId(TID.btn("until")));
    await waitFor(() => expect(within(forms.until).getByTestId(TID.msgForm).textContent).toMatch(/03:00/));

    expect(within(card).getByTestId("offer-remaining").textContent).toContain("2");
    expect(card.textContent).toContain("5");
    expect((within(forms.add).getByTestId(TID.field("count")) as HTMLInputElement).value).toBe("16");
    expect((within(forms.reduce).getByTestId(TID.field("count")) as HTMLInputElement).value).toBe("3");
    expect((within(forms.partyMax).getByTestId(TID.field("partyMax")) as HTMLInputElement).value).toBe("11");
    expect((within(forms.until).getByTestId(TID.field("until")) as HTMLInputElement).value).toBe("14:00");
    expect(screen.getByTestId("arrivals")).toBeTruthy();
  });

  it("19.12 offer_ended では文が出たあとホームを取り直し、公開のフォームに変わる。通る応答では文が無く数字が変わる", async () => {
    let ended = false;
    let remaining = 2;
    const home = () => (ended ? storeHomeDto({ offer: null }) : storeHomeDto({ offer: offerDto({ capacity: 5, remaining }) }));
    const card = await renderOffer(home, {
      "POST /api/store/offers/current/add": () => {
        if (ended) return refusal("offer_ended");
        remaining += 1;
        return { json: { ok: true, offer: offerDto({ capacity: 6, remaining }) } };
      },
    });
    const add = within(card).getByTestId(TID.form("add"));
    fireEvent.change(within(add).getByTestId(TID.field("count")), { target: { value: "1" } });
    fireEvent.click(within(add).getByTestId(TID.btn("add")));
    await waitFor(() => expect(within(card).getByTestId("offer-remaining").textContent).toContain("3"));
    expect(within(add).queryByTestId(TID.msg("count"))).toBeNull();
    expect(within(add).queryByTestId(TID.msgForm)).toBeNull();
    ended = true;
    fireEvent.click(within(add).getByTestId(TID.btn("add")));
    await waitFor(() => expect(screen.queryByTestId("offer-card")).toBeNull());
    expect(await screen.findByTestId(TID.form("publish"))).toBeTruthy();
  });
});
