// @vitest-environment jsdom
// 要件22（画面）: 22.8 はじめての受け取りの直後に説明、22.9・22.10 説明の中身、22.11 二度と出ない、22.8〜 「通知を受け取る」で公開鍵は入口の値。
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { componentOf, homeFetch, installFakeApi, reservationDto, type FakeApi } from "./_fakes";
import { TID } from "./_types";

const installPush = (permission: NotificationPermission = "default") => {
  const subscribeCalls: any[] = [];
  const registration = { pushManager: { subscribe: async (opts: any) => (subscribeCalls.push(opts), { endpoint: "https://push.example.test/1", toJSON: () => ({ endpoint: "https://push.example.test/1", keys: { p256dh: "x", auth: "y" } }) }), getSubscription: async () => null } };
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register: async () => registration, ready: Promise.resolve(registration) } });
  (globalThis as any).Notification = { permission, requestPermission: async () => "granted" };
  (globalThis as any).PushManager = function PushManager() {};
  return subscribeCalls;
};

describeTask("19", "通知の許可の求め", () => {
  let api: FakeApi;
  afterEach(() => {
    cleanup();
    api?.restore();
    window.localStorage.clear();
  });

  const renderActive = async (pushPromptDue: boolean, vapidPublicKey = "vapid-A") => {
    api = installFakeApi({
      "GET /api/config/public": () => ({ json: { turnstileSiteKey: "s", vapidPublicKey, contactEmail: null } }),
      "GET /api/customer/home": () => ({ json: { ...homeFetch(), kind: "active", reservation: reservationDto(), pushPromptDue } }),
      "POST /api/customer/push-subscription": () => ({ json: { ok: true } }),
    });
    const CustomerApp = await componentOf("components/customer/CustomerApp", "CustomerApp");
    render(<CustomerApp />);
    return screen.findByTestId(TID.view("active"));
  };

  it("22.8・22.9・22.10 はじめての受け取りの直後（pushPromptDue）に説明が出て、2つの場面だけ通知すること・届かない端末があること・開けば分かることが書いてある", async () => {
    installPush();
    await renderActive(true);
    const prompt = await screen.findByTestId("push-prompt");
    expect(prompt.textContent).toMatch(/店/);
    expect(prompt.textContent).toMatch(/運営/);
    expect(prompt.textContent).toMatch(/取り消され/);
    expect(prompt.textContent).toMatch(/だけ/);
    expect(prompt.textContent).toMatch(/届かない/);
    expect(prompt.textContent).toMatch(/開/);
    expect(screen.getByTestId(TID.btn("push-allow"))).toBeTruthy();
    expect(screen.getByTestId(TID.btn("push-decline"))).toBeTruthy();
  });

  it("22.8 pushPromptDue が false なら出ない", async () => {
    installPush();
    await renderActive(false);
    expect(screen.queryByTestId("push-prompt")).toBeNull();
  });

  it("「通知を受け取る」で、subscribe に渡る applicationServerKey が公開値の入口の vapidPublicKey で、購読が入口へ送られる。値を変えると渡る値も変わる。22.11 答えたあとは二度と出ない", async () => {
    const b64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    // "vapid-A" と "vapid-B" を base64url にしたもの（実物の公開鍵と同じ形）
    for (const key of ["dmFwaWQtQQ", "dmFwaWQtQg"]) {
      const calls = installPush();
      await renderActive(true, key);
      fireEvent.click(await screen.findByTestId(TID.btn("push-allow")));
      await waitFor(() => expect(calls).toHaveLength(1));
      const passed = calls[0].applicationServerKey;
      const passedBytes = typeof passed === "string" ? b64url(passed) : Buffer.from(passed instanceof ArrayBuffer ? new Uint8Array(passed) : passed);
      expect(Buffer.compare(passedBytes, b64url(key))).toBe(0);
      expect(calls[0].userVisibleOnly).toBe(true);
      await waitFor(() => expect(api.calls.filter((c) => c.path === "/api/customer/push-subscription")).toHaveLength(1));
      expect(api.calls.find((c) => c.path === "/api/customer/push-subscription")!.body.subscription.endpoint).toBe("https://push.example.test/1");
      await waitFor(() => expect(screen.queryByTestId("push-prompt")).toBeNull());
      cleanup();
      await renderActive(true, key);
      await new Promise((r) => setTimeout(r, 30));
      expect(screen.queryByTestId("push-prompt")).toBeNull();
      cleanup();
      api.restore();
      window.localStorage.clear();
    }
  });

  it("22.11 「今はしない」を押したあとも二度と出ない（購読は作らない）", async () => {
    const calls = installPush();
    await renderActive(true);
    fireEvent.click(await screen.findByTestId(TID.btn("push-decline")));
    await waitFor(() => expect(screen.queryByTestId("push-prompt")).toBeNull());
    expect(calls).toHaveLength(0);
    cleanup();
    await renderActive(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId("push-prompt")).toBeNull();
  });
});
