// @vitest-environment jsdom
// 客向けの利用規約（2026-09-26 本人選択・Google Maps Platform の利用規約 3.2.2(a)(i)）。
// 見るのは: Google マップの機能を含むと知らせ、その利用に Google Maps End User Additional Terms（Google マップ /
// Google Earth 追加利用規約）と Google プライバシーポリシーが適用されると書き、2本へのリンクを置くこと。
// 店向けの利用規約（app/store/terms）にも同じ1文を置く。どの画面の下からも辿れること（殻の SiteFooter）。

import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import TermsPage from "./page";
import StoreTermsPage from "../store/terms/page";
import { SiteFooter } from "../../components/ui/SiteFooter";

const GOOGLE_MAPS_TERMS_URL = "https://maps.google.com/help/terms_maps/";
const GOOGLE_PRIVACY_URL = "https://policies.google.com/privacy";

const expectGoogleMapsNotice = () => {
  const section = screen.getByTestId("terms-google-maps");
  expect(section.textContent).toMatch(/Google マップの機能/);
  const hrefs = within(section)
    .getAllByRole("link")
    .map((a) => a.getAttribute("href"));
  expect(hrefs).toEqual(expect.arrayContaining([GOOGLE_MAPS_TERMS_URL, GOOGLE_PRIVACY_URL]));
  expect(section.textContent).toMatch(/Google マップ \/ Google Earth 追加利用規約/);
  expect(section.textContent).toMatch(/Google プライバシーポリシー/);
};

describe("客向けの利用規約（Google マップの機能）", () => {
  afterEach(() => cleanup());

  it("Google マップの機能を含むことと、追加利用規約とプライバシーポリシーが適用されることを、2本のリンクつきで書く", () => {
    render(<TermsPage />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("利用規約");
    expectGoogleMapsNotice();
    expect(screen.getByRole("link", { name: /送信先と個人情報/ }).getAttribute("href")).toBe("/privacy");
    expect(screen.getByTestId("contact-email")).toBeTruthy();
  });

  it("店向けの利用規約にも同じ知らせを置く", () => {
    render(<StoreTermsPage />);
    expectGoogleMapsNotice();
  });

  it("どの画面の下にも、利用規約へのリンクを置く", () => {
    render(<SiteFooter />);
    expect(screen.getByRole("link", { name: "利用規約" }).getAttribute("href")).toBe("/terms");
  });

  // 2026-09-26 本人選択（AI提示）: 事業者の名称・住所は公開を再開するまで「準備中」のまま。/privacy と2つの利用規約は
  // 同じ正本（lib/domain/texts の OPERATOR_IDENTITY）の表記を出し、公開の歯止め（scripts/deploy-guard.mjs）が準備中のままの公開を止める
  it("客向けと店向けの利用規約の問い合わせ先に、事業者の表記（今は準備中）が出る", () => {
    for (const Page of [TermsPage, StoreTermsPage]) {
      render(<Page />);
      const contact = screen.getByTestId("terms-contact");
      expect(within(contact).getByTestId("operator-identity").textContent).toMatch(/事業者: イマセキの運営者（名称・住所・代表者は準備中です/);
      cleanup();
    }
  });
});

