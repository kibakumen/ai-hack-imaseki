// @vitest-environment jsdom
// 店向けの利用規約（2026-09-25 監査の指摘 店-21 の案1）。
// 見るのは: カードを預かる目的と「今は請求しない」こと・登録を取り消す条件と戻す手続き・客のデータの扱いの義務・
// 営業許可書の扱い（使い道と消す時）・退会・問い合わせ先の6つが在ること。

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import StoreTermsPage from "./page";

describe("店向けの利用規約（店-21）", () => {
  afterEach(() => cleanup());

  it("カードの目的と今は請求しないこと・登録を取り消す条件と戻す手続き・客のデータの義務・許可書の扱い・退会・連絡先が在る", () => {
    render(<StoreTermsPage />);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/カード/);
    expect(body).toMatch(/請求しません/);
    // 店を止める操作と状態の呼び方は「登録を取り消す」に揃えた（2026-09-25 監査の指摘 横断-11）
    expect(body).toMatch(/登録を取り消す/);
    expect(body).toMatch(/戻す/);
    expect(body).toMatch(/電話番号/);
    expect(body).toMatch(/営業許可書/);
    expect(body).toMatch(/消します/);
    expect(body).toMatch(/退会/);
    expect(screen.getByTestId("contact-email")).toBeTruthy();
    for (const id of ["terms-card", "terms-ban", "terms-customer-data", "terms-license", "terms-withdraw", "terms-contact"]) expect(screen.getByTestId(id), id).toBeTruthy();
  });

  it("退会の節は、店の画面から退会できること・消えるもの・残るもの（「退会した店」）・登録し直せることを書く（2026-09-26 本人発案（店の退会）・要件13の基準 13.13〜13.19）", () => {
    render(<StoreTermsPage />);
    const withdraw = screen.getByTestId("terms-withdraw").textContent ?? "";
    expect(withdraw).toMatch(/退会の手続きへ/);
    expect(withdraw).toMatch(/今のパスワード/);
    expect(withdraw).toMatch(/営業許可書/);
    expect(withdraw).toMatch(/クーポン/);
    expect(withdraw).toMatch(/退会した店/);
    expect(withdraw).toMatch(/通知/);
    expect(withdraw).toMatch(/登録し直せます/);
    expect(withdraw).not.toMatch(/今は下の連絡先へのメールで受け付けます/);
  });
});
