// @vitest-environment jsdom
// おすすめメニューの欄の Enter（2026-09-25 監査の指摘 店-17）。
// それまでメニューの欄はフォームの中で Enter の手当てが無く、スマホのキーボードで確定を押すとフォーム全体が
// 保存され、打った1件は足されなかった（しかも住所を地図に問い合わせる処理まで走った）。

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { installFakeApi, PROFILE, type FakeApi } from "../../../tests/acceptance/v2/_fakes";
import { ProfileForm } from "./ProfileForm";

let api: FakeApi | null = null;

afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
});

const renderForm = async () => {
  api = installFakeApi({
    "GET /api/store/profile": () => ({ json: { ok: true, profile: { ...PROFILE, menus: [] } } }),
    "PUT /api/store/profile": () => ({ json: { ok: true, profile: PROFILE } }),
  });
  render(<ProfileForm />);
  return (await screen.findByTestId("field-menu")) as HTMLInputElement;
};

const saves = () => api!.calls.filter((c) => c.method === "PUT").length;

describe("おすすめメニューの Enter（店-17）", () => {
  it("メニューの欄で Enter を押すと1件足され、店の情報全体は保存しない", async () => {
    const field = await renderForm();
    expect(field.getAttribute("enterkeyhint")).toBeTruthy();
    fireEvent.change(field, { target: { value: "焼き鳥盛り" } });
    fireEvent.keyDown(field, { key: "Enter", code: "Enter" });
    expect(screen.getByText("焼き鳥盛り")).toBeTruthy();
    expect(field.value).toBe("");
    expect(saves()).toBe(0);
  });

  it("日本語の変換中の Enter（確定）では足さない", async () => {
    const field = await renderForm();
    fireEvent.change(field, { target: { value: "やきとり" } });
    fireEvent.keyDown(field, { key: "Enter", code: "Enter", isComposing: true, keyCode: 229 });
    expect(screen.queryByText("やきとり")).toBeNull();
    expect(field.value).toBe("やきとり");
    expect(saves()).toBe(0);
  });
});
