// @vitest-environment jsdom
// 承認待ちと止められた店への説明（2026-09-25 監査の指摘 店-12）。
//
// それまで帯は決まった1文だけで、運営の連絡先はログインの画面の「パスワードを忘れた場合」にしか無く、
// 止められたときに向かっていた客がどうなったか（取り消され、客に通知済み）も出なかった。

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { installFakeApi, type FakeApi } from "../../../tests/acceptance/v2/_fakes";
import { StatusBanner } from "./StatusBanner";

let api: FakeApi | null = null;

afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
});

const withContact = (contactEmail: string | null) => {
  api = installFakeApi({ "GET /api/config/public": () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail } }) });
};

describe("承認の状況の帯（店-12）", () => {
  it("未承認: 許可書を確かめてから承認することと、運営の連絡先が出る", async () => {
    withContact("ops@example.test");
    render(<StatusBanner status="pending" />);
    const banner = screen.getByTestId("status-banner");
    expect(banner.textContent).toMatch(/許可書を確かめてから/);
    await waitFor(() => expect(banner.querySelector('a[href="mailto:ops@example.test"]')).not.toBeNull());
  });

  it("止められている: 向かっていた客の確保は取り消されて客に通知済みで、期限切れも完了にできないことと、運営の連絡先が出る", async () => {
    withContact("ops@example.test");
    render(<StatusBanner status="banned" />);
    const banner = screen.getByTestId("status-banner");
    expect(banner.textContent).toMatch(/登録を取り消されて/);
    expect(banner.textContent).toMatch(/キャンセルされ/);
    expect(banner.textContent).toMatch(/通知済み/);
    expect(banner.textContent).toMatch(/期限切れ.*完了にすることもできません/);
    await waitFor(() => expect(banner.querySelector('a[href="mailto:ops@example.test"]')).not.toBeNull());
  });

  it("承認済みの札には連絡先を出さない（開いた直後に見たいものを押し出さない）", () => {
    withContact("ops@example.test");
    render(<StatusBanner status="approved" />);
    expect(screen.getByTestId("status-banner").textContent).not.toMatch(/連絡/);
  });
});
