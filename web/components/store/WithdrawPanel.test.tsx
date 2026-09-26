// @vitest-environment jsdom
// 店の退会の画面（2026-09-26 本人発案・要件13の基準 13.13・13.17 の画面の側）。
//
// 取り返しがつかないので、確かめを開いてから今のパスワードを入れて押す2段にする。確かめには、消えるもの・残るものと、
// 今向かっている客の組数（ホームの向かっている客のうち確保中の行）が取り消されて通知されることを出す。

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { installFakeApi, refusal, storeHomeDto, type FakeApi } from "../../../tests/acceptance/v2/_fakes";
import { TEXTS } from "../../lib/domain/texts";
import { WithdrawPanel } from "./WithdrawPanel";

let api: FakeApi | null = null;
afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
});

const arrival = (kind: "active" | "expired" | "completed", id: string) => ({
  reservationId: id,
  kind,
  nickname: null,
  phone: null,
  party: 2,
  code: "12345678",
  expiresAt: "2026-09-22T06:30:00.000Z",
  canComplete: true,
  canCancel: kind === "active",
});

const withdrawCalls = () => api!.calls.filter((c) => c.method === "POST" && c.path === "/api/store/withdraw");

describe("店の退会の画面", () => {
  it("確かめを開くまでパスワードの欄は出ない。確かめには向かっている客の組数（確保中の行だけ）が出て、今のパスワードつきで送る", async () => {
    api = installFakeApi({
      "GET /api/store/home": () => ({ json: storeHomeDto({ arrivals: [arrival("active", "r1"), arrival("active", "r2"), arrival("expired", "r3")] }) }),
      "POST /api/store/withdraw": () => ({ json: { ok: true, cancelled: 2 } }),
    });
    render(<WithdrawPanel />);
    fireEvent.click(await screen.findByTestId("btn-withdraw-open"));
    const confirm = screen.getByTestId("confirm-withdraw");
    expect(screen.getByTestId("withdraw-active").textContent).toContain("2 組");
    expect(confirm.textContent).toContain("営業許可書");
    expect(confirm.textContent).toContain("退会した店");

    // パスワードを入れるまで押せない
    expect((screen.getByTestId("btn-withdraw") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("field-currentPassword"), { target: { value: "store-pass-1234" } });
    fireEvent.click(screen.getByTestId("btn-withdraw"));
    const done = await screen.findByTestId("withdrawn");
    expect(done.textContent).toContain("2 組");
    expect(withdrawCalls().at(-1)!.body).toEqual({ currentPassword: "store-pass-1234" });
    expect(screen.queryByTestId("btn-withdraw-open")).toBeNull();
  });

  it("向かっている客がいなければ組数の文は出さない。今のパスワードが合わなければ欄の直下に文が出て、退会していない", async () => {
    api = installFakeApi({
      "GET /api/store/home": () => ({ json: storeHomeDto() }),
      "POST /api/store/withdraw": () => refusal("password_mismatch", { fields: [{ name: "currentPassword", reason: "not_allowed" }] }) as never,
    });
    render(<WithdrawPanel />);
    fireEvent.click(await screen.findByTestId("btn-withdraw-open"));
    expect(screen.queryByTestId("withdraw-active")).toBeNull();
    fireEvent.change(screen.getByTestId("field-currentPassword"), { target: { value: "wrong-pass-1" } });
    fireEvent.click(screen.getByTestId("btn-withdraw"));
    const message = await screen.findByTestId("msg-currentPassword");
    expect(message.textContent).toBe(TEXTS.inputRefusal("password_mismatch"));
    expect(screen.queryByTestId("withdrawn")).toBeNull();
  });

  it("登録取り消し済みの店には退会の操作を出さず、運営への連絡を案内する", async () => {
    api = installFakeApi({
      "GET /api/store/home": () => ({ json: storeHomeDto({ status: "banned" }) }),
      "GET /api/config/public": () => ({ json: { turnstileSiteKey: "", vapidPublicKey: "v", contactEmail: "ops@example.com" } }),
    });
    render(<WithdrawPanel />);
    await screen.findByTestId("withdraw-banned");
    expect(screen.queryByTestId("btn-withdraw-open")).toBeNull();
  });
});
