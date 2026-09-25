// @vitest-environment jsdom
// 要件28（画面・【最終日】）: 28.4 自分の画面から消せる、28.9 消した応答で端末に残した内容を消し、28.11 開き直すと登録の入力。28.5 の断りの表示。
//
// 2026-09-25 監査の指摘 安全-15 で戻した。2026-09-22 に「客の情報は残さない想定なので要らない」として画面ごと撤去したが、
// 実際には入れた電話番号は customers に残り、取得のたびに起点の緯度経度が記録に入り、通知の宛先も残っていた。
// 画面から消す手段が無いと要件28の基準 28.4 を満たさない。入口は**客の画面の下端の1つのボタン**にした
// （登録の確認の画面は戻さない——本人の「登録いる？」の方向を守る）。
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { componentOf, homeFetch, installFakeApi, refusal, reservationDto, type FakeApi } from "./_fakes";
import { TID } from "./_types";

describeTask("32", "登録の消去（画面）", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
    window.localStorage.clear();
  });

  it("28.4・28.9・28.11 画面の下端から消せ、消すと端末に残した内容が消え、登録の入力に戻る。28.5 断られると文が出て確保中の表示のまま", async () => {
    let deleted = false;
    let refuse = true;
    const reservation = reservationDto({ code: "77778888" });
    api = installFakeApi({
      "GET /api/config/public": () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } }),
      "GET /api/customer/home": () => (deleted ? { status: 401, json: { ok: false, error: { kind: "unauthenticated" } } } : { json: { ...homeFetch(), kind: "active", reservation } }),
      "DELETE /api/customer": () => {
        if (refuse) return refusal("has_active_reservation");
        deleted = true;
        return { json: { ok: true } };
      },
    });
    const CustomerApp = await componentOf("components/customer/CustomerApp", "CustomerApp");
    render(<CustomerApp />);
    await screen.findByTestId(TID.view("active"));
    await waitFor(() => expect(JSON.stringify(window.localStorage)).toContain("77778888"));
    fireEvent.click(screen.getByTestId(TID.btn("delete-account")));
    fireEvent.click(within(await screen.findByTestId("confirm-delete")).getByTestId(TID.btn("confirm")));
    await waitFor(() => expect(screen.getByTestId(TID.form("delete")).querySelector(`[data-testid="${TID.msgForm}"]`)!.textContent).toMatch(/取り消/));
    expect(screen.getByTestId(TID.view("active"))).toBeTruthy();
    refuse = false;
    fireEvent.click(screen.getByTestId(TID.btn("delete-account")));
    fireEvent.click(within(await screen.findByTestId("confirm-delete")).getByTestId(TID.btn("confirm")));
    await screen.findByTestId(TID.field("nickname"));
    expect(JSON.stringify(window.localStorage)).not.toContain("77778888");
    expect(screen.queryByTestId(TID.view("active"))).toBeNull();
  });

  it("28.4 取得の画面（確保の無い客）の下端にも「この端末の登録を消す」が在り、押しただけでは消さずに確かめを挟む", async () => {
    api = installFakeApi({
      "GET /api/config/public": () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } }),
      "GET /api/customer/home": () => ({ json: homeFetch() }),
    });
    const CustomerApp = await componentOf("components/customer/CustomerApp", "CustomerApp");
    render(<CustomerApp />);
    await screen.findByTestId(TID.btn("fetch"));
    const button = screen.getByTestId(TID.btn("delete-account"));
    expect(button.textContent).toMatch(/この端末の登録を消す/);
    fireEvent.click(button);
    expect(await screen.findByTestId("confirm-delete")).toBeTruthy();
    expect(api.calls.filter((c) => c.method === "DELETE")).toHaveLength(0);
  });
});
