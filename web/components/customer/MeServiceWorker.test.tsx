// @vitest-environment jsdom
// 客の画面（/me）を開いたときの Service Worker と通知の購読（2026-09-25 設計-04）。
// どちらも確かめる検査が1本も無かったので、直す前に、直ったときの振る舞いを先に書いておいた（it.fails）。
// 2026-09-25 に不具合-05・不具合-11 を直したので、普通の it に戻した。
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { homeFetch, installFakeApi, type FakeApi } from "../../../tests/acceptance/v2/_fakes";
import { CustomerApp } from "./CustomerApp";

type Stubbed = { register: ReturnType<typeof vi.fn>; subscribe: ReturnType<typeof vi.fn> };

/** 通知と Service Worker の仕組みを持つ端末のつもり。permission は端末の答え（granted／default） */
const installPushDevice = (permission: NotificationPermission): Stubbed => {
  const subscribe = vi.fn(async () => ({ toJSON: () => ({ endpoint: "https://push.example/sub-1", keys: { p256dh: "p", auth: "a" } }) }));
  const registration = { pushManager: { getSubscription: async () => null, subscribe } };
  const register = vi.fn(async () => registration);
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register, ready: Promise.resolve(registration) } });
  vi.stubGlobal("PushManager", function PushManager() {});
  vi.stubGlobal("Notification", Object.assign(function Notification() {}, { permission, requestPermission: async () => permission }));
  return { register, subscribe };
};

describe("客の画面を開いたときの Service Worker と通知の購読", () => {
  let api: FakeApi | null = null;
  afterEach(() => {
    cleanup();
    api?.restore();
    api = null;
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, "serviceWorker");
    window.localStorage.clear();
  });

  const renderMe = async () => {
    api = installFakeApi({
      "GET /api/config/public": () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "BAAAAA", contactEmail: null } }),
      "GET /api/customer/home": () => ({ json: homeFetch() }),
      "POST /api/customer/push-subscription": () => ({ json: { ok: true } }),
    });
    render(<CustomerApp />);
    await screen.findByTestId("btn-fetch");
    // 開いた直後の非同期の処理（登録・購読の確かめ）が済むのを待つ
    await new Promise((resolve) => setTimeout(resolve, 50));
  };

  // 電波の無い所で /me を開き直せるように、通知の許可と切り離して、開いたときに /me の範囲で登録する。
  it("不具合-05 通知を許可していなくても、/me を開いたときに Service Worker を /me の範囲で登録する", async () => {
    const device = installPushDevice("default");
    await renderMe();
    expect(device.register).toHaveBeenCalledWith("/sw.js", expect.objectContaining({ scope: "/me" }));
  });

  // 購読が切れても作り直されないと、確保の取り消しなどの通知が黙って届かなくなる。
  it("不具合-11 通知が許可済みなのに購読が無ければ、開いたときに黙って購読を作り直して入口へ預ける", async () => {
    installPushDevice("granted");
    window.localStorage.setItem("ai-hack:push-answered", "1");
    await renderMe();
    expect(api!.calls.filter((c) => c.method === "POST" && c.path === "/api/customer/push-subscription")).toHaveLength(1);
  });

  it("不具合-11 許可済みで端末に購読も在るなら、開いただけでは預け直さない（サーバーが「無い」と言ったときだけ預け直す）", async () => {
    const device = installPushDevice("granted");
    const existing = { toJSON: () => ({ endpoint: "https://push.example/sub-0", keys: { p256dh: "p", auth: "a" } }) };
    const registration = { pushManager: { getSubscription: async () => existing, subscribe: device.subscribe } };
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register: device.register, ready: Promise.resolve(registration) } });
    await renderMe();
    expect(device.subscribe).not.toHaveBeenCalled();
    expect(api!.calls.filter((c) => c.path === "/api/customer/push-subscription")).toHaveLength(0);
  });

  it("不具合-11 「今はしない」の印が端末に在っても、許可済みの端末の購読の作り直しは止めない", async () => {
    installPushDevice("granted");
    window.localStorage.setItem("ai-hack:push-answered", "declined");
    await renderMe();
    expect(api!.calls.filter((c) => c.path === "/api/customer/push-subscription")).toHaveLength(1);
  });

  it("不具合-05 以前の版が / の範囲で登録した Service Worker は外す（どの画面も /me の殻として保存していた）", async () => {
    installPushDevice("default");
    const oldOne = { scope: "http://localhost:3000/", unregister: vi.fn(async () => true) };
    const current = { scope: "http://localhost:3000/me", unregister: vi.fn(async () => true) };
    const sw = navigator.serviceWorker as unknown as Record<string, unknown>;
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { ...sw, register: vi.fn(async () => ({ scope: current.scope })), getRegistrations: async () => [oldOne, current] },
    });
    await renderMe();
    expect(oldOne.unregister).toHaveBeenCalled();
    expect(current.unregister).not.toHaveBeenCalled();
  });
});
