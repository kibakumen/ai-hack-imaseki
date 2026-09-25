// @vitest-environment jsdom
// 店に確保を取り消された客が、その店を運営へ知らせられる（2026-09-25 監査の指摘 横断-09 の案A）。
// 店まで歩いて行って断られた場面が、いちばん不快なのに運営へ届かなかった。
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { homeFetch, installFakeApi, reservationDto, type FakeApi } from "../../../tests/acceptance/v2/_fakes";
import { CustomerApp } from "./CustomerApp";

let api: FakeApi | null = null;
afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
});

describe("店に取り消された表示からの通報", () => {
  it("「店の都合で取り消されました」の表示に通報ボタンが在り、押すとその店を宛先にした通報の入力が開く", async () => {
    api = installFakeApi({
      "GET /api/config/public": () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } }),
      "GET /api/customer/home": () => ({ json: { ...homeFetch(), kind: "store_cancelled", reservation: reservationDto({ status: "store_cancelled", storeName: "取り消した店" }) } }),
      "GET /api/customer/recent": () => ({ json: { items: [] } }),
    });
    render(<CustomerApp />);
    const view = await screen.findByTestId("view-store_cancelled");
    fireEvent.click(within(view).getByTestId("btn-report"));
    const form = await screen.findByTestId("form-report");
    expect(form.textContent).toMatch(/取り消した店/);
  });
});
