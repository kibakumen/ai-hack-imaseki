// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any -- 偽の API の本文は、この検査の中だけで読む値（受け入れ検査の _fakes と同じ扱い） */
// 公開中のカード（2026-09-25 監査の指摘 店-03・店-05・店-06・店-09・店-15・店-16）。
// 本番の入口の部品（StoreHome）を偽の API で描き、カードの振る舞いを見る。

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { installFakeApi, offerDto, storeHomeDto, type FakeApi } from "../../../tests/acceptance/v2/_fakes";
import { StoreHome } from "./StoreHome";

let api: FakeApi | null = null;

afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
});

const arrival = (id: string, kind: "active" | "completed" = "active") => ({
  reservationId: id,
  kind,
  nickname: null,
  phone: null,
  party: 2,
  code: "12345678",
  expiresAt: "2026-09-22T06:20:00.000Z",
  canComplete: kind === "active",
  canCancel: kind === "active",
});

const renderCard = async (home: Record<string, unknown>, routes: Record<string, any> = {}) => {
  api = installFakeApi({
    "GET /api/store/home": () => ({ json: storeHomeDto(home as any) }),
    "GET /api/config/public": () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } }),
    ...routes,
  });
  render(<StoreHome />);
  return screen.findByTestId("offer-card");
};

const posts = () => api!.calls.filter((c) => c.method === "POST").map((c) => c.path);

describe("「公開を止める」の確かめ（店-03）", () => {
  it("押すと確かめが出て、再開できないことと向かっている N 組がそのまま来ることを伝える。確かめるまで止める入口を呼ばない", async () => {
    const card = await renderCard(
      { offer: offerDto(), arrivals: [arrival("r1"), arrival("r2"), arrival("r3", "completed")] },
      { "POST /api/store/offers/current/stop": () => ({ json: { ok: true } }) },
    );
    fireEvent.click(within(card).getByTestId("btn-stop"));
    const confirm = within(card).getByTestId("confirm-stop");
    expect(confirm.textContent).toMatch(/再開できません/);
    expect(confirm.textContent).toMatch(/向かっている 2 組/);
    expect(posts()).toEqual([]);

    fireEvent.click(within(confirm).getByRole("button", { name: "やめる" }));
    expect(within(card).queryByTestId("confirm-stop")).toBeNull();
    expect(posts()).toEqual([]);

    fireEvent.click(within(card).getByTestId("btn-stop"));
    fireEvent.click(within(card).getByTestId("btn-confirm-stop"));
    await waitFor(() => expect(posts()).toEqual(["/api/store/offers/current/stop"]));
  });
});

describe("配信数のダイヤルの範囲と「受付を締める」（店-09）", () => {
  it("配信数10・残り2 なら、ダイヤルは受け取り済みの 8 から、残りが20になる 28 まで。下げられない理由が出る", async () => {
    const card = await renderCard({ offer: offerDto({ capacity: 10, remaining: 2 }) });
    const items = [...within(card).getByTestId("dial-capacity").querySelectorAll(".store-dial__item")].map((e) => e.textContent);
    expect(items[0]).toBe("8");
    expect(items[items.length - 1]).toBe("28");
    expect(within(card).getByTestId("dial-capacity").textContent).toMatch(/受け取り済みの 8 組より下げられません/);
  });

  it("まだ誰も受け取っていなければ下限は 1（配信数3・残り3 → 1〜20）", async () => {
    const card = await renderCard({ offer: offerDto({ capacity: 3, remaining: 3 }) });
    const items = [...within(card).getByTestId("dial-capacity").querySelectorAll(".store-dial__item")].map((e) => e.textContent);
    expect(items[0]).toBe("1");
    expect(items[items.length - 1]).toBe("20");
  });

  it("「受付を締める」は残りの数だけ減らす入口を1回呼ぶ。残りが0なら押せない", async () => {
    const card = await renderCard(
      { offer: offerDto({ capacity: 5, remaining: 3 }) },
      { "POST /api/store/offers/current/reduce": () => ({ json: { ok: true, offer: offerDto({ capacity: 2, remaining: 0 }) } }) },
    );
    fireEvent.click(within(card).getByTestId("btn-close-intake"));
    await waitFor(() => expect(posts()).toEqual(["/api/store/offers/current/reduce"]));
    expect(api!.calls.find((c) => c.path === "/api/store/offers/current/reduce")!.body).toEqual({ count: 3 });
    cleanup();
    api!.restore();
    const full = await renderCard({ offer: offerDto({ capacity: 5, remaining: 0 }) });
    expect((within(full).getByTestId("btn-close-intake") as HTMLButtonElement).disabled).toBe(true);
  });

  // レビューの指摘（2026-09-25）: 誰も受け取っていないオファーで「受付を締める」を押すと配信数が0になる。
  // それまでは範囲の下限が1のままで、ダイヤルは「0」ではなく「1」に印を付けて描き、▲は押せなかった（店-04 と同じ種類の症状）。
  it("配信数0・残り0（誰も受け取らずに受付を締めた）なら、印の付いた目盛りは「0」で、▼で1にすると追加で1組を送る", async () => {
    const card = await renderCard(
      { offer: offerDto({ capacity: 0, remaining: 0 }) },
      { "POST /api/store/offers/current/add": () => ({ json: { ok: true, offer: offerDto({ capacity: 1, remaining: 1 }) } }) },
    );
    const dial = within(card).getByTestId("dial-capacity");
    expect(dial.querySelector(".store-dial__item--on")?.textContent).toBe("0");
    expect([...dial.querySelectorAll(".store-dial__item")].map((e) => e.textContent)[0]).toBe("0");

    fireEvent.click(dial.querySelector(".store-dial__step--down")!);
    expect(dial.querySelector(".store-dial__item--on")?.textContent).toBe("1");
    fireEvent.click(within(card).getByTestId("btn-update"));
    await waitFor(() => expect(posts()).toEqual(["/api/store/offers/current/add"]));
    expect(api!.calls.find((c) => c.path === "/api/store/offers/current/add")!.body).toEqual({ count: 1 });
  });
});

// レビューの指摘（2026-09-25）: クーポンの選び直しが同じオファーのままになった（不具合-03）ので、取り直しでカードが
// 作り直されなくなった。選んだクーポンを描き始めに1回だけ作っていたため、別の端末で選び直されても画面は古いまま残り、
// 触っていないのに「1 項目を変えます」が出て、そのまま「更新する」を押すと別の端末の選び直しを黙って戻していた。
describe("見せるクーポンの選択は、札に触っていない間はサーバーの今の値に合わせる", () => {
  const c1 = { id: "c1", name: "生ビール", note: "", createdAt: "2026-09-01T00:00:00Z" };
  const c2 = { id: "c2", name: "デザート", note: "", createdAt: "2026-09-01T00:01:00Z" };
  const shownOf = (ids: string[]) => [c1, c2].filter((c) => ids.includes(c.id)).map(({ id, name, note }) => ({ id, name, note }));

  /** 取り直しのたびに `server.ids` を見せる店のホーム。何名までの変更（通る）で取り直しを起こす */
  const renderWithServer = async (server: { ids: string[] }) => {
    api = installFakeApi({
      "GET /api/store/home": () => ({ json: storeHomeDto({ offer: offerDto({ partyMax: 4, coupons: shownOf(server.ids) }), coupons: [c1, c2] }) }),
      "GET /api/config/public": () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } }),
      "POST /api/store/offers/current/party-max": () => ({ json: { ok: true, offer: offerDto({ partyMax: 5, coupons: shownOf(server.ids) }) } }),
    });
    render(<StoreHome />);
    return screen.findByTestId("offer-card");
  };
  const homeLoads = () => api!.calls.filter((c) => c.method === "GET" && c.path === "/api/store/home").length;
  /** 何名までを1つ変えて送る（通る）→ カードがホームを取り直す */
  const reloadHome = async (card: HTMLElement) => {
    const before = homeLoads();
    fireEvent.change(within(card).getByTestId("field-partyMax"), { target: { value: "5" } });
    fireEvent.submit(within(card).getByTestId("form-party-max"));
    await waitFor(() => expect(homeLoads()).toBeGreaterThan(before));
  };
  const checked = (id: string) => within(screen.getByTestId("offer-card")).getByTestId(`offer-coupon-${id}`).getAttribute("aria-checked");
  const sticky = () => within(screen.getByTestId("offer-card")).getByTestId("offer-update-bar").getAttribute("data-sticky");

  it("別の端末で選び直されたら、取り直しで選択がサーバーの値に変わり、「更新する」は貼り付かない", async () => {
    const server = { ids: ["c1"] };
    const card = await renderWithServer(server);
    expect(checked("c1")).toBe("true");
    server.ids = ["c2"];
    await reloadHome(card);
    await waitFor(() => expect(checked("c2")).toBe("true"));
    expect(checked("c1")).toBe("false");
    expect(sticky()).toBe("false");
  });

  it("札に触って送っていない選択は、取り直しでも消さない（「1 項目を変えます」のまま）", async () => {
    const server = { ids: ["c1"] };
    const card = await renderWithServer(server);
    fireEvent.click(within(card).getByTestId("offer-coupon-c2"));
    await reloadHome(card);
    expect(checked("c1")).toBe("true");
    expect(checked("c2")).toBe("true");
    expect(sticky()).toBe("true");
  });
});

describe("残りが0のときのバッジ（店-16）", () => {
  it("残りが0なら「満席」で、いまは客に出ていないことと、配信数を増やせばまた出ることを伝える", async () => {
    const card = await renderCard({ offer: offerDto({ capacity: 4, remaining: 0 }) });
    const badge = within(card).getByTestId("offer-status");
    expect(badge.textContent).toMatch(/満席/);
    expect(badge.textContent).not.toMatch(/配信中/);
    expect(card.textContent).toMatch(/客に出ていません/);
    expect(card.textContent).toMatch(/配信数を増やすと、また客に出ます/);
  });

  it("残りがあれば「配信中」", async () => {
    const card = await renderCard({ offer: offerDto({ capacity: 4, remaining: 1 }) });
    expect(within(card).getByTestId("offer-status").textContent).toMatch(/配信中/);
    expect(card.textContent).not.toMatch(/客に出ていません/);
  });
});

describe("終了タイマーの畳み方（店-05・店-06）", () => {
  it("何時までの欄は初め畳まれている。終了タイマーの無いオファーは「自動で HH:MM に終了」と出る", async () => {
    const card = await renderCard({ offer: offerDto({ untilSet: false, untilAt: "2026-09-22T18:00:00.000Z" }) });
    const toggle = within(card).getByRole("button", { name: /終了タイマー/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(within(card).getByTestId("form-until").textContent).toMatch(/自動で 03:00 に終了/);
    fireEvent.click(toggle);
    expect(within(card).getByRole("button", { name: /終了タイマー/ }).getAttribute("aria-expanded")).toBe("true");
  });

  it("終了タイマーのあるオファーは「HH:MM に終了」と出る", async () => {
    const card = await renderCard({ offer: offerDto({ untilSet: true, untilAt: "2026-09-22T13:30:00.000Z" }) });
    expect(within(card).getByTestId("form-until").textContent).toMatch(/22:30 に終了/);
    expect(within(card).getByTestId("form-until").textContent).not.toMatch(/自動で/);
  });
});

describe("「更新する」は変えたところがある間だけ画面の下に貼り付く（店-06）", () => {
  it("変えていない間は貼り付かず、何名までを1つ上げると貼り付く", async () => {
    const card = await renderCard({ offer: offerDto({ partyMax: 4 }) });
    const foot = within(card).getByTestId("offer-update-bar");
    expect(foot.getAttribute("data-sticky")).toBe("false");
    fireEvent.change(within(card).getByTestId("field-partyMax"), { target: { value: "5" } });
    expect(within(card).getByTestId("offer-update-bar").getAttribute("data-sticky")).toBe("true");
  });
});

describe("「今日の動き」（店-15）", () => {
  it("応答の trend から、結果に出た数と受け取りの2本の線を時刻の軸で描き、合計を出す", async () => {
    const trend = [
      { at: "2026-09-22T06:00:00.000Z", shown: 2, received: 0 },
      { at: "2026-09-22T06:15:00.000Z", shown: 5, received: 1 },
      { at: "2026-09-22T06:30:00.000Z", shown: 3, received: 2 },
    ];
    const card = await renderCard({ offer: offerDto({ capacity: 5, remaining: 2 }), trend });
    const chart = within(card).getByTestId("offer-trend");
    expect(chart.querySelectorAll("polyline.store-chart__line--shown")).toHaveLength(1);
    expect(chart.querySelectorAll("polyline.store-chart__line--received")).toHaveLength(1);
    expect(within(chart).getByTestId("trend-shown-total").textContent).toContain("10");
    expect(within(chart).getByTestId("trend-received-total").textContent).toContain("3");
    expect(chart.textContent).toMatch(/15:00/);
    expect(chart.textContent).toMatch(/15:30/);
  });
});
