// @vitest-environment jsdom
// 送信先と個人情報の扱い（2026-09-25 監査の指摘 安全-18 の案1）。
// 見るのは: 外へ送っている先が全部表に載り、AI に呼び名と電話番号を渡さないことと、消し方と、
// 個人情報保護法32条の公表事項（事業者・利用目的・開示等の手続・苦情の申出先・安全管理）の見出しが在ること。
// どの画面の下にも、この一覧へのリンクが在ること（殻の SiteFooter）。

import React from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PrivacyPage from "./page";
import { SiteFooter } from "../../components/ui/SiteFooter";

describe("送信先と個人情報の扱い", () => {
  afterEach(() => cleanup());

  it("外へ送っている先（Cloudflare・Google・OrcaRouter・通知の配信元・Stripe・メールの送信の Resend）が、送る情報・いつ・目的つきで表に載る", () => {
    render(<PrivacyPage />);
    const table = screen.getByTestId("privacy-destinations");
    for (const name of ["Cloudflare", "Turnstile", "Google", "OrcaRouter", "通知", "Stripe", "音声", "Resend"]) expect(table.textContent, name).toContain(name);
    const headers = within(table).getAllByRole("columnheader").map((th) => th.textContent);
    expect(headers).toEqual(["送信先（事業者・国）", "送る情報", "いつ", "何のため"]);
    // AI に渡すものに呼び名と電話番号が入らないことを明記する（要件28の基準 28.3）
    expect(screen.getByTestId("privacy-ai-row").textContent).toMatch(/呼び名と電話番号は渡しません/);
  });

  it("消し方と、消したあとも残るもの（起点の記録）を書き、個人情報保護法の公表事項の見出しが在る", () => {
    render(<PrivacyPage />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/この端末の登録を消す/);
    expect(body).toMatch(/起点/);
    for (const heading of ["事業者", "利用目的", "開示", "苦情", "安全管理"]) expect(body, heading).toContain(heading);
  });

  // 2026-09-26 本人選択: 場所の候補（Google が返した文字）を選んで探したときは、その文字を記録に残さない（place ID だけ）
  it("探したときの記録に、場所の候補や現在地の地名（Google の文字）を残さないことを、保存するものと消したあとも残るものの両方に書く", () => {
    render(<PrivacyPage />);
    expect(screen.getByTestId("privacy-destinations").textContent).toMatch(/候補[^。]*地名[^。]*残しません/);
    const erase = screen.getByRole("heading", { name: "保存しているものと、消し方" }).parentElement?.textContent ?? "";
    expect(erase).toMatch(/候補[^。]*地名[^。]*残しません/);
  });

  it("どの画面の下にも、この一覧へのリンクを置く", () => {
    render(<SiteFooter />);
    expect(screen.getByRole("link", { name: /送信先と個人情報/ }).getAttribute("href")).toBe("/privacy");
  });
});
