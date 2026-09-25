// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any -- 偽の API の本文は、この検査の中だけで読む値（受け入れ検査の _fakes と同じ扱い） */
// 押したあとの手応えと二重送信の止め（2026-09-25 監査の指摘 横断-03）。
//
// それまで送っている間にボタンを止めていたのは「今すぐ探す」と公開中のカードの「更新する」だけだった。
// ほかの操作は送っている間も押せ、見た目も変わらず（クーポンの「作る」を2回押すと2枚でき、通報は重ねて届いた）、
// 客の取り消しや人数の変更は画面が切り替わるだけで何も出なかった。
// 見るのは: ①送っている間はもう1度押しても1回しか送らず、ボタンが止まり文言が替わる ②済んだら role=status で知らせる。

import React from "react";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { homeFetch, installFakeApi, reservationDto, storeHomeDto, type FakeApi, type FakeReply } from "../../../tests/acceptance/v2/_fakes";
import { SUBMIT_TEXTS } from "../../lib/domain/texts";
import { EmailForm } from "../auth/EmailForm";
import { LoginForm } from "../auth/LoginForm";
import { CustomerApp } from "../customer/CustomerApp";
import { RegisterForm as CustomerRegisterForm } from "../customer/RegisterForm";
import { ReportForm } from "../customer/ReportForm";
import { CouponEditor } from "../store/CouponEditor";
import { DocumentsPanel } from "../store/DocumentsPanel";
import { PasswordForm } from "../store/PasswordForm";
import { ProfileForm } from "../store/ProfileForm";
import { PublishForm } from "../store/PublishForm";
import { RegisterForm as StoreRegisterForm } from "../store/RegisterForm";
import { DoneNotice } from "./Submit";
import { useSubmit } from "./useSubmit";

vi.mock("../../lib/client/geolocation", () => ({ currentLocation: async () => ({ ok: true, lat: 35.6, lng: 139.7 }) }));

let api: FakeApi | null = null;
afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
  window.localStorage.clear();
});

/** 押してから答えが返るまでを、検査が開けるまで止めておく門。 */
const gate = () => {
  let open: () => void = () => undefined;
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open: () => open() };
};

const NO_TURNSTILE = () => ({ json: { turnstileSiteKey: "", vapidPublicKey: "v", contactEmail: null } });
const count = (method: string, path: string) => api!.calls.filter((c) => c.method === method && c.path === path).length;

describe("useSubmit（横断-03）", () => {
  it("送っている途中にもう1度呼んでも送らず null。済んだら done に1文、断りは failure に", async () => {
    const g = gate();
    const send = vi.fn(async () => {
      await g.wait;
      return { ok: true as const, saved: 1 };
    });
    const { result } = renderHook(() => useSubmit());
    let first: Promise<unknown> = Promise.resolve();
    let second: unknown = "未";
    await act(async () => {
      first = result.current.run(send, (r) => `保存 ${r.saved}`);
      second = await result.current.run(send);
    });
    expect(second).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(true);
    await act(async () => {
      g.open();
      await first;
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.done).toBe("保存 1");
    expect(result.current.failure).toBeNull();

    await act(async () => {
      await result.current.run(async () => ({ ok: false as const, error: { kind: "rate_limited" } }) as any, "出さない");
    });
    expect(result.current.failure?.error?.kind).toBe("rate_limited");
    expect(result.current.done).toBeNull();
    act(() => result.current.clear());
    expect(result.current.failure).toBeNull();
  });
});

/**
 * 1つのフォームぶんの場面。描いて、送れる形に入れ、押すボタンを返す。押したら `path` へ1回だけ送ること。
 * `reply` は通ったときの応答。
 */
type Scene = { name: string; method: string; path: string; routes?: Record<string, () => FakeReply>; reply: FakeReply; mount: () => Promise<HTMLElement>; busyLabel?: string };

const SCENES: Scene[] = [
  {
    name: "通報の「送る」",
    method: "POST",
    path: "/api/customer/reports",
    reply: { status: 201, json: { ok: true } },
    mount: async () => {
      render(<ReportForm storeId="s1" storeName="テスト食堂" onClose={() => undefined} />);
      fireEvent.change(screen.getByTestId("field-reason"), { target: { value: "店が開いていませんでした" } });
      return screen.getByTestId("btn-send-report");
    },
  },
  {
    name: "クーポンの「作る」",
    method: "POST",
    path: "/api/store/coupons",
    routes: { "GET /api/store/coupons": () => ({ json: { ok: true, items: [] } }) },
    reply: { status: 201, json: { ok: true, coupon: { id: "c1", name: "生ビール1杯", note: "", createdAt: "2026-09-25T01:00:00.000Z" } } },
    mount: async () => {
      render(<CouponEditor />);
      fireEvent.change(await screen.findByTestId("field-name"), { target: { value: "生ビール1杯" } });
      return screen.getByTestId("btn-create-coupon");
    },
  },
  {
    name: "営業許可書を上げる（最大10MB）",
    method: "POST",
    path: "/api/store/license",
    routes: { "GET /api/store/home": () => ({ json: storeHomeDto({ status: "pending", checklist: { license: false, card: false } as any }) }) },
    reply: { json: { ok: true } },
    busyLabel: SUBMIT_TEXTS.uploading,
    mount: async () => {
      render(<DocumentsPanel />);
      const file = new File(["%PDF"], "license.pdf", { type: "application/pdf" });
      fireEvent.change(await screen.findByTestId("field-file"), { target: { files: [file] } });
      return screen.getByTestId("btn-upload-license");
    },
  },
  {
    name: "カードを登録する",
    method: "POST",
    path: "/api/store/card/setup",
    routes: { "GET /api/store/home": () => ({ json: storeHomeDto({ status: "pending", checklist: { license: true, card: false } as any }) }) },
    reply: { status: 400, json: { ok: false, error: { kind: "card_setup_failed" } } },
    mount: async () => {
      render(<DocumentsPanel />);
      return screen.findByTestId("btn-card-setup");
    },
  },
  {
    name: "オファーを公開する",
    method: "POST",
    path: "/api/store/offers",
    reply: { status: 400, json: { ok: false, error: { kind: "offer_exists" } } },
    mount: async () => {
      render(<PublishForm coupons={[]} prefill={{ couponIds: [], capacity: 3, partyMax: 4, until: null }} onPublished={() => undefined} />);
      return screen.getByTestId("btn-publish");
    },
  },
  {
    name: "店舗情報の「保存する」",
    method: "PUT",
    path: "/api/store/profile",
    routes: {
      "GET /api/store/profile": () => ({ json: { ok: true, profile: { name: "店", address: "東京都渋谷区1-1", url: null, genres: ["和食"], menus: [], budgetMin: 1000, budgetMax: 3000 } } }),
    },
    reply: { json: { ok: true } },
    mount: async () => {
      render(<ProfileForm />);
      return screen.findByTestId("btn-save-profile");
    },
  },
  {
    name: "ログイン",
    method: "POST",
    path: "/api/auth/login",
    routes: { "GET /api/config/public": NO_TURNSTILE },
    reply: { status: 401, json: { ok: false, error: { kind: "login_failed" } } },
    mount: async () => {
      render(<LoginForm />);
      fireEvent.change(screen.getByTestId("field-email"), { target: { value: "store@example.com" } });
      fireEvent.change(screen.getByTestId("field-password"), { target: { value: "password-123" } });
      return screen.getByTestId("btn-login");
    },
  },
  {
    name: "店の登録",
    method: "POST",
    path: "/api/register/store",
    routes: { "GET /api/config/public": NO_TURNSTILE },
    reply: { status: 409, json: { ok: false, error: { kind: "email_taken" } } },
    mount: async () => {
      render(<StoreRegisterForm />);
      fireEvent.click(screen.getByTestId("field-agreeTerms"));
      return screen.getByTestId("btn-register");
    },
  },
  {
    name: "客の登録（自動の登録が通らなかったときの受け皿）",
    method: "POST",
    path: "/api/register/customer",
    routes: { "GET /api/config/public": NO_TURNSTILE },
    reply: { status: 429, json: { ok: false, error: { kind: "rate_limited" } } },
    mount: async () => {
      render(<CustomerRegisterForm onRegistered={() => undefined} />);
      return screen.getByTestId("btn-register");
    },
  },
  {
    name: "メールアドレスを変える",
    method: "POST",
    path: "/api/store/email",
    reply: { json: { ok: true } },
    mount: async () => {
      render(<EmailForm endpoint="/api/store/email" />);
      return screen.getByTestId("btn-change-email");
    },
  },
  {
    name: "パスワードを決める",
    method: "POST",
    path: "/api/store/password",
    reply: { json: { ok: true } },
    mount: async () => {
      render(<PasswordForm />);
      return screen.getByTestId("btn-change-password");
    },
  },
];

describe("送っている間は押せず、何度押しても1回だけ送る（横断-03）", () => {
  for (const scene of SCENES) {
    it(scene.name, async () => {
      const g = gate();
      api = installFakeApi({
        ...(scene.routes ?? {}),
        [`${scene.method} ${scene.path}`]: async () => {
          await g.wait;
          return scene.reply;
        },
      });
      const button = await scene.mount();
      fireEvent.click(button);
      fireEvent.click(button);
      await waitFor(() => expect(count(scene.method, scene.path)).toBe(1));
      await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(true));
      expect(button.textContent).toBe(scene.busyLabel ?? SUBMIT_TEXTS.sending);
      expect(button.getAttribute("aria-busy")).toBe("true");
      fireEvent.click(button);
      expect(count(scene.method, scene.path)).toBe(1);
      await act(async () => {
        g.open();
      });
    });
  }
});

describe("済んだことを知らせる（横断-03）", () => {
  it("通報は送れたら欄を畳み、送れたことを role=status で出す（「送る」をもう押せない）", async () => {
    api = installFakeApi({ "POST /api/customer/reports": () => ({ status: 201, json: { ok: true } }) });
    render(<ReportForm storeId="s1" storeName="テスト食堂" onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId("field-reason"), { target: { value: "店が開いていませんでした" } });
    fireEvent.click(screen.getByTestId("btn-send-report"));
    const sent = await screen.findByTestId("report-sent");
    expect(sent.getAttribute("role")).toBe("status");
    expect(screen.queryByTestId("btn-send-report")).toBeNull();
    expect(screen.queryByTestId("field-reason")).toBeNull();
  });

  it("客の「この店に行く」は、押したカードが「席を確保しています…」になり、ほかのカードも押せない。2度押しても1回", async () => {
    const g = gate();
    const reservation = reservationDto({ code: "13572468" });
    const item = (id: string) => ({ offerId: id, storeId: `s-${id}`, storeName: `店${id}`, walkMinutes: 3, budgetMin: 2000, budgetMax: 4000, reason: "合います", partyMax: 4, coupons: [], storeUrl: null, storeAddress: null });
    api = installFakeApi({
      "GET /api/config/public": NO_TURNSTILE,
      "GET /api/customer/home": () => ({ json: homeFetch() }),
      "POST /api/customer/fetch": () => ({ json: { ok: true, fetchId: "f1", items: [item("o1"), item("o2")] } }),
      "POST /api/customer/reservations": async () => {
        await g.wait;
        return { json: { ok: true, reservation, home: homeFetch({ kind: "active", reservation }) } };
      },
    });
    render(<CustomerApp />);
    fireEvent.click(await screen.findByTestId("btn-fetch"));
    const pressed = within(await screen.findByTestId("result-o1")).getByTestId("btn-receive") as HTMLButtonElement;
    const other = within(screen.getByTestId("result-o2")).getByTestId("btn-receive") as HTMLButtonElement;
    fireEvent.click(pressed);
    fireEvent.click(pressed);
    await waitFor(() => expect(pressed.textContent).toBe(SUBMIT_TEXTS.receiving));
    expect(pressed.disabled).toBe(true);
    expect(other.disabled).toBe(true);
    fireEvent.click(other);
    expect(count("POST", "/api/customer/reservations")).toBe(1);
    await act(async () => {
      g.open();
    });
    await screen.findByTestId("view-active");
  });

  it("客が確保を取り消したら、取得の画面の上に「確保を取り消しました。」を出す。送っている間は「取り消す」を押せない", async () => {
    const g = gate();
    const reservation = reservationDto();
    api = installFakeApi({
      "GET /api/config/public": NO_TURNSTILE,
      "GET /api/customer/home": () => ({ json: homeFetch({ kind: "active", reservation }) }),
      "POST /api/customer/reservations/:id/cancel": async () => {
        await g.wait;
        return { json: { ok: true, home: homeFetch() } };
      },
    });
    render(<CustomerApp />);
    fireEvent.click(await screen.findByTestId("btn-cancel"));
    const confirm = within(screen.getByTestId("confirm-cancel")).getByTestId("btn-confirm") as HTMLButtonElement;
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(confirm.disabled).toBe(true));
    expect(count("POST", `/api/customer/reservations/${reservation.id}/cancel`)).toBe(1);
    await act(async () => {
      g.open();
    });
    const notice = await screen.findByTestId("done-notice");
    expect(notice.textContent).toBe(SUBMIT_TEXTS.reservationCancelled);
    expect(notice.getAttribute("role")).toBe("status");
    expect(screen.getByTestId("btn-fetch")).toBeTruthy();
  });

  it("人数を変えたら「人数を 3 名に変えました。」を出す", async () => {
    const reservation = reservationDto({ party: 2 });
    api = installFakeApi({
      "GET /api/config/public": NO_TURNSTILE,
      "GET /api/customer/home": () => ({ json: homeFetch({ kind: "active", reservation }) }),
      "POST /api/customer/reservations/:id/party": () => ({ json: { ok: true, home: homeFetch({ kind: "active", reservation: { ...reservation, party: 3 } }) } }),
    });
    render(<CustomerApp />);
    fireEvent.change(await screen.findByTestId("field-party"), { target: { value: "3" } });
    fireEvent.click(screen.getByTestId("btn-change-party"));
    const notice = await screen.findByTestId("done-notice");
    expect(notice.textContent).toBe(SUBMIT_TEXTS.partyChanged(3));
  });

  it("クーポンを作ったら「クーポンを作りました。」を出す", async () => {
    let items: any[] = [];
    api = installFakeApi({
      "GET /api/store/coupons": () => ({ json: { ok: true, items } }),
      "POST /api/store/coupons": () => {
        items = [{ id: "c1", name: "生ビール1杯", note: "", createdAt: "2026-09-25T01:00:00.000Z" }];
        return { status: 201, json: { ok: true, coupon: items[0] } };
      },
    });
    render(<CouponEditor />);
    fireEvent.change(await screen.findByTestId("field-name"), { target: { value: "生ビール1杯" } });
    fireEvent.click(screen.getByTestId("btn-create-coupon"));
    const notice = await screen.findByTestId("done-notice");
    expect(notice.textContent).toBe(SUBMIT_TEXTS.couponCreated);
    await screen.findByTestId("row-c1");
  });
});

/**
 * 読み上げの領域（role=status）は、中身が変わる前から DOM に在らないと告げない組み合わせが多い
 * （横断-03 のレビュー）。それまで DoneNotice と通報の「送りました」は、知らせが来た瞬間に role=status の入れ物ごと
 * 差し込んでいた。見るのは、知らせの前から空の領域が在り、知らせはその同じ入れ物の中身として出ること。
 */
describe("済んだ知らせの読み上げの領域（横断-03 のレビュー）", () => {
  it("DoneNotice は知らせが無くても空の role=status を描き、知らせは同じ入れ物に入る", () => {
    const { rerender } = render(<DoneNotice message={null} testId="notice" />);
    const region = screen.getByRole("status");
    expect(region.textContent).toBe("");
    expect(screen.queryByTestId("notice")).toBeNull();
    rerender(<DoneNotice message="保存しました。" testId="notice" />);
    expect(screen.getByTestId("notice")).toBe(region);
    expect(region.textContent).toBe("保存しました。");
  });

  it("クーポンを作ったときの知らせは、押す前から在った領域に入る", async () => {
    let items: any[] = [];
    api = installFakeApi({
      "GET /api/store/coupons": () => ({ json: { ok: true, items } }),
      "POST /api/store/coupons": () => {
        items = [{ id: "c1", name: "生ビール1杯", note: "", createdAt: "2026-09-25T01:00:00.000Z" }];
        return { status: 201, json: { ok: true, coupon: items[0] } };
      },
    });
    render(<CouponEditor />);
    fireEvent.change(await screen.findByTestId("field-name"), { target: { value: "生ビール1杯" } });
    const region = within(screen.getByTestId("form-coupon")).getByRole("status");
    expect(region.textContent).toBe("");
    fireEvent.click(screen.getByTestId("btn-create-coupon"));
    expect(await screen.findByTestId("done-notice")).toBe(region);
  });

  it("通報の「送りました」は、送る前から在った領域に入り、焦点は「閉じる」へ移る（body へ落とさない）", async () => {
    api = installFakeApi({ "POST /api/customer/reports": () => ({ status: 201, json: { ok: true } }) });
    render(<ReportForm storeId="s1" storeName="テスト食堂" onClose={() => undefined} />);
    const region = screen.getByRole("status");
    expect(region.textContent).toBe("");
    fireEvent.change(screen.getByTestId("field-reason"), { target: { value: "店が開いていませんでした" } });
    const send = screen.getByTestId("btn-send-report");
    send.focus();
    fireEvent.click(send);
    expect(await screen.findByTestId("report-sent")).toBe(region);
    expect(region.textContent).toBe(SUBMIT_TEXTS.reportSent);
    await waitFor(() => expect(document.activeElement?.textContent).toBe("閉じる"));
  });
});
