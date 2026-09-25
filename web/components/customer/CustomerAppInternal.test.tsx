// @vitest-environment jsdom
// 客の画面が、サーバーの不具合（500・internal）を「登録が消えた」と取り違えないこと
// （監査の指摘 設計-15・2026-09-25）。
//
// それまで 500 は JSON でない本文で返り、画面は「通信に失敗した」として端末に残した確保を出していた。
// 入口が 500 を JSON（kind: internal）で返すようになったので、画面の側も internal を
// network と同じく「取り直せば直るかもしれない失敗」として扱い、登録の入力へ倒さない。
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { homeFetch, installFakeApi, reservationDto, type FakeApi } from "../../../tests/acceptance/v2/_fakes";
import { CustomerApp } from "./CustomerApp";

let api: FakeApi | null = null;
afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
  vi.useRealTimers();
  window.localStorage.clear();
});

// 端末に何も残っていない（プライベートモード・保存を止めた端末）ときも、登録の入力は出さない
// （2026-09-25 レビューの指摘）。登録の入力へ倒すのは 401 のときだけ（設計書「客の画面」の優先の順の1）で、
// 出すと客が入れ直して登録し、新しい識別子の Cookie が今の Cookie を上書きしてしまう。
it.each([
  ["500・internal", () => ({ status: 500, json: { ok: false, error: { kind: "internal" } } })],
  [
    "通信の失敗",
    () => {
      throw new TypeError("Failed to fetch");
    },
  ],
])("初めの取得が %s で端末にも何も無いときは、登録の入力を出さず、読めなかったことと読み直す道を出す。直れば取得の画面へ", async (_label, failing) => {
  let down = true;
  api = installFakeApi({
    "GET /api/config/public": () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } }),
    "GET /api/customer/home": () => (down ? failing() : { json: homeFetch() }),
  });
  render(<CustomerApp />);
  await screen.findByTestId("load-failed");
  expect(screen.queryByTestId("form-register")).toBeNull();
  expect(screen.queryByTestId("field-nickname")).toBeNull();
  down = false;
  await act(async () => {
    screen.getByTestId("btn-retry").click();
  });
  await screen.findByTestId("btn-fetch");
  expect(screen.queryByTestId("load-failed")).toBeNull();
});

it("取り直しが 500・internal を返しても、確保中の表示と「確かめられていません」を出し、登録の入力へ倒さない", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let broken = false;
  const reservation = reservationDto({ code: "77778888" });
  api = installFakeApi({
    "GET /api/config/public": () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } }),
    "GET /api/customer/home": () => (broken ? { status: 500, json: { ok: false, error: { kind: "internal" } } } : { json: { ...homeFetch(), kind: "active", reservation } }),
  });
  render(<CustomerApp />);
  await screen.findByTestId("view-active");
  broken = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30_000);
  });
  expect(screen.getByTestId("view-active").textContent).toContain("77778888");
  expect(screen.getByTestId("stale-notice")).toBeTruthy();
});

// 客にはログインが無く、/login は店と運営の入口（2026-09-25 レビューの指摘）。客の画面の操作が
// 401・403 を受けたときに「ログインが切れました」「ログインし直して」と出すと、客は次に何をすればよいか分からない。
// 読み込み直せば入口（GuestEntry）が識別子を作り直すので、客にはそれを言う。
it.each([
  ["401・unauthenticated", 401, "unauthenticated"],
  ["403・forbidden", 403, "forbidden"],
])("確保への操作が %s を受けても「ログイン」を言わず、ページを読み込み直すよう出す", async (_label, status, kind) => {
  const reservation = reservationDto({ code: "13572468" });
  api = installFakeApi({
    "GET /api/config/public": () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } }),
    "GET /api/customer/home": () => ({ json: { ...homeFetch(), kind: "active", reservation } }),
    "POST /api/customer/reservations/:id/cancel": () => ({ status, json: { ok: false, error: { kind } } }),
  });
  render(<CustomerApp />);
  await screen.findByTestId("view-active");
  fireEvent.click(screen.getByTestId("btn-cancel"));
  fireEvent.click(within(screen.getByTestId("confirm-cancel")).getByTestId("btn-confirm"));
  const message = await screen.findByTestId("msg-form");
  expect(message.textContent).not.toMatch(/ログイン/);
  expect(message.textContent).toMatch(/読み込み直/);
});
