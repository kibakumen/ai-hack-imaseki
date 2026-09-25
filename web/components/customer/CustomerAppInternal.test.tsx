// @vitest-environment jsdom
// 客の画面が、サーバーの不具合（500・internal）を「登録が消えた」と取り違えないこと
// （監査の指摘 設計-15・2026-09-25）。
//
// それまで 500 は JSON でない本文で返り、画面は「通信に失敗した」として端末に残した確保を出していた。
// 入口が 500 を JSON（kind: internal）で返すようになったので、画面の側も internal を
// network と同じく「取り直せば直るかもしれない失敗」として扱い、登録の入力へ倒さない。
import React from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
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
