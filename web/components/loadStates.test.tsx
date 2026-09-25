// @vitest-environment jsdom
// 店と運営の画面が、ログインが切れたとき・読み込めなかったときに行き止まりにならないこと
// （監査の指摘 横断-01・2026-09-25）。
//
// それまで、店のホームは空の main で止まり（タブも出ない）、30秒ごとの取り直しは失敗を無視して
// 古い一覧を出し続けた。書類は空の section、クーポンは「まだありません」、運営の通報の一覧は
// 「通報はまだありません」になり、どこにもログインへ戻る道が無かった。
//   - 読み込みを loading・failed・empty・ready の4つで扱い、失敗を0件と区別する
//   - 401（unauthenticated）を受けたら「ログインが切れました」と出して /login へ案内する
//   - 取り直しが続けて失敗している間は「最終更新 HH:MM・更新できていません」の帯を出す
import React from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installFakeApi, PROFILE, storeHomeDto, type FakeApi } from "../../tests/acceptance/v2/_fakes";
import { TEXTS } from "../lib/domain/texts";
import { ReportList } from "./admin/ReportList";
import { CouponEditor } from "./store/CouponEditor";
import { DocumentsPanel } from "./store/DocumentsPanel";
import { ProfileForm } from "./store/ProfileForm";
import { StoreHome } from "./store/StoreHome";
import { SessionExpiredNotice } from "./ui/SessionExpired";

const UNAUTHENTICATED = { status: 401, json: { ok: false, error: { kind: "unauthenticated" } } };
const NETWORK_DOWN = () => {
  throw new TypeError("Failed to fetch");
};

let api: FakeApi | null = null;
afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
  vi.useRealTimers();
});

describe("ログインが切れたとき", () => {
  it("店のホームは空で止まらず、タブと「ログインが切れました」と /login への道を出す", async () => {
    api = installFakeApi({ "GET /api/store/home": () => UNAUTHENTICATED });
    render(
      <>
        <SessionExpiredNotice />
        <StoreHome />
      </>,
    );
    const notice = await screen.findByTestId("session-expired");
    expect(notice.textContent).toContain(TEXTS.inputRefusal("unauthenticated"));
    expect(notice.querySelector("a")?.getAttribute("href")).toBe("/login");
    expect(screen.getByTestId("load-failed")).toBeTruthy();
    expect(screen.getByRole("navigation")).toBeTruthy();
  });

  it("運営の通報の一覧は「通報はまだありません」を出さない", async () => {
    api = installFakeApi({ "GET /api/admin/reports": () => UNAUTHENTICATED });
    render(
      <>
        <SessionExpiredNotice />
        <ReportList />
      </>,
    );
    await screen.findByTestId("session-expired");
    expect(screen.getByTestId("load-failed")).toBeTruthy();
    expect(screen.queryByTestId("reports-empty")).toBeNull();
  });

  it("ログインの失敗（login_failed の 401）では、切れた知らせを出さない", async () => {
    api = installFakeApi({ "GET /api/admin/reports": () => ({ status: 401, json: { ok: false, error: { kind: "login_failed" } } }) });
    render(
      <>
        <SessionExpiredNotice />
        <ReportList />
      </>,
    );
    await screen.findByTestId("load-failed");
    expect(screen.queryByTestId("session-expired")).toBeNull();
  });
});

describe("読み込めなかったときは0件と区別する", () => {
  it("クーポンは「まだありません」を出さず、読み直す道を出す。読み直して取れれば一覧が出る", async () => {
    let down = true;
    api = installFakeApi({ "GET /api/store/coupons": () => (down ? NETWORK_DOWN() : { json: { ok: true, items: [{ id: "c1", name: "生ビール1杯", note: "", createdAt: "2026-09-22T06:00:00.000Z" }] } }) });
    render(<CouponEditor />);
    await screen.findByTestId("load-failed");
    expect(screen.queryByText(/クーポンはまだありません/)).toBeNull();
    down = false;
    await act(async () => {
      screen.getByTestId("btn-retry").click();
    });
    await screen.findByTestId("row-c1");
    expect(screen.queryByTestId("load-failed")).toBeNull();
  });

  it("クーポンが本当に0件なら「まだありません」を出す", async () => {
    api = installFakeApi({ "GET /api/store/coupons": () => ({ json: { ok: true, items: [] } }) });
    render(<CouponEditor />);
    await screen.findByText(/クーポンはまだありません/);
    expect(screen.queryByTestId("load-failed")).toBeNull();
  });

  it("書類の画面は空の section で止まらない", async () => {
    api = installFakeApi({ "GET /api/store/home": () => ({ status: 500, json: { ok: false, error: { kind: "internal" } } }) });
    render(<DocumentsPanel />);
    const failed = await screen.findByTestId("load-failed");
    expect(failed.textContent).toContain(TEXTS.inputRefusal("internal"));
    expect(failed.textContent).not.toContain(TEXTS.inputRefusal("network"));
  });

  // 空の欄を出すと、店は「消えた」と思って入れ直し、入れ直さなかった URL やおすすめメニューを
  // 空で上書きしてしまう（2026-09-25 レビューの指摘）。読めたときだけ、値の入った欄を出す。
  it("店の情報は、読めなかったときに空の欄を出さず、断りの文と読み直す道を出す。読み直して取れれば値の入った欄が出る", async () => {
    let down = true;
    api = installFakeApi({ "GET /api/store/profile": () => (down ? NETWORK_DOWN() : { json: { ok: true, profile: PROFILE } }) });
    render(<ProfileForm />);
    const failed = await screen.findByTestId("load-failed");
    expect(failed.textContent).toContain(TEXTS.inputRefusal("network"));
    expect(screen.queryByTestId("form-profile")).toBeNull();
    down = false;
    await act(async () => {
      screen.getByTestId("btn-retry").click();
    });
    const name = (await screen.findByTestId("field-name")) as HTMLInputElement;
    expect(name.value).toBe(PROFILE.name);
    expect((screen.getByTestId("field-url") as HTMLInputElement).value).toBe(PROFILE.url);
    expect(screen.getByTestId("form-profile").textContent).toContain(PROFILE.menus[0]);
    expect(screen.queryByTestId("load-failed")).toBeNull();
  });

  it("店の情報は、サーバーの不具合（500・internal）でも空の欄を出さない", async () => {
    api = installFakeApi({ "GET /api/store/profile": () => ({ status: 500, json: { ok: false, error: { kind: "internal" } } }) });
    render(<ProfileForm />);
    const failed = await screen.findByTestId("load-failed");
    expect(failed.textContent).toContain(TEXTS.inputRefusal("internal"));
    expect(screen.queryByTestId("form-profile")).toBeNull();
    expect(screen.queryByTestId("btn-save-profile")).toBeNull();
  });
});

describe("店のホームの取り直し", () => {
  it("取り直しが失敗している間は、前の一覧を残して「最終更新 HH:MM・更新できていません」を出し、直れば消す", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let mode: "ok" | "down" = "ok";
    api = installFakeApi({ "GET /api/store/home": () => (mode === "down" ? NETWORK_DOWN() : { json: storeHomeDto() }) });
    render(<StoreHome />);
    await screen.findByRole("navigation");
    await waitFor(() => expect(screen.queryByTestId("load-loading")).toBeNull());
    mode = "down";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    const band = await screen.findByTestId("refresh-failed");
    expect(band.textContent).toMatch(/最終更新 \d{2}:\d{2}・更新できていません/);
    expect(screen.queryByTestId("load-failed")).toBeNull();
    mode = "ok";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    await waitFor(() => expect(screen.queryByTestId("refresh-failed")).toBeNull());
  });
});
