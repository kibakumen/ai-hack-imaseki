// @vitest-environment jsdom
// 通知の説明の置き場所と、iPhone のホーム画面の案内（2026-09-25 監査の指摘 客-04・客-05）。
//
//   客-05 … 通知の説明が確保番号より上に出て、仕組みの無い端末では消せないまま居座っていた
//   客-04 … 確保中の画面で「ホーム画面に追加して開き直すと受け取れます」と案内し、従った客ほど今の確保を失った。
//           manifest も無かった。許可を求める問いは、押した直後に出す

import React from "react";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { homeFetch, installFakeApi, reservationDto, type FakeApi } from "../../../tests/acceptance/v2/_fakes";
import { CustomerApp } from "./CustomerApp";
import manifest from "../../app/manifest";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const CONFIG = () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "dmFwaWQtQQ", contactEmail: null } });

let api: FakeApi | null = null;
const originalUa = navigator.userAgent;
const setUserAgent = (ua: string) => Object.defineProperty(window.navigator, "userAgent", { configurable: true, get: () => ua });

afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
  window.localStorage.clear();
  setUserAgent(originalUa);
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

const renderHome = async (home: Record<string, unknown>, extra: Record<string, () => { json: unknown }> = {}) => {
  api = installFakeApi({ "GET /api/config/public": CONFIG, "GET /api/customer/home": () => ({ json: home }), ...extra });
  render(<CustomerApp />);
};

const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe("確保中の画面の通知の説明（客-05）", () => {
  it("通知の説明は、確保番号・経路・クーポンより下に出る", async () => {
    await renderHome(homeFetch({ kind: "active", reservation: reservationDto(), pushPromptDue: true }));
    const prompt = await screen.findByTestId("push-prompt");
    expect(follows(screen.getByTestId("reservation-code"), prompt)).toBe(true);
    expect(follows(screen.getByTestId("btn-route"), prompt)).toBe(true);
    expect(follows(screen.getByTestId("coupon-list"), prompt)).toBe(true);
  });

  it("通知の仕組みが無い端末では、許可のボタンの代わりに「閉じる」が在り、閉じたら開き直しても出ない", async () => {
    await renderHome(homeFetch({ kind: "active", reservation: reservationDto(), pushPromptDue: true }));
    const prompt = await screen.findByTestId("push-prompt");
    expect(screen.queryByTestId("btn-push-allow")).toBeNull();
    expect(prompt.textContent).toMatch(/通知が届きません/);
    fireEvent.click(screen.getByTestId("btn-push-dismiss"));
    await waitFor(() => expect(screen.queryByTestId("push-prompt")).toBeNull());
    cleanup();
    api?.restore();
    await renderHome(homeFetch({ kind: "active", reservation: reservationDto(), pushPromptDue: true }));
    await screen.findByTestId("view-active");
    expect(screen.queryByTestId("push-prompt")).toBeNull();
  });
});

describe("iPhone のホーム画面の案内（客-04）", () => {
  it("iPhone の Safari では、確保中の画面は「今の確保はこの画面（Safari）で見て」と案内し、ホーム画面への追加は勧めない", async () => {
    setUserAgent(IPHONE_UA);
    await renderHome(homeFetch({ kind: "active", reservation: reservationDto(), pushPromptDue: true }));
    const prompt = await screen.findByTestId("push-prompt");
    expect(prompt.textContent).toMatch(/今の確保はこの画面（Safari）で見てください/);
    expect(prompt.textContent).not.toMatch(/開き直すと受け取れます/);
    expect(screen.queryByTestId("home-screen-hint")).toBeNull();
  });

  it("iPhone の Safari で確保を持っていない取得の画面には、ホーム画面に追加すると通知が届く案内が出る。閉じたら出ない", async () => {
    setUserAgent(IPHONE_UA);
    await renderHome(homeFetch());
    const hint = await screen.findByTestId("home-screen-hint");
    expect(hint.textContent).toMatch(/ホーム画面に追加/);
    fireEvent.click(screen.getByTestId("btn-home-hint-close"));
    await waitFor(() => expect(screen.queryByTestId("home-screen-hint")).toBeNull());
    cleanup();
    api?.restore();
    await renderHome(homeFetch());
    await screen.findByTestId("btn-fetch");
    expect(screen.queryByTestId("home-screen-hint")).toBeNull();
  });

  it("iPhone でない端末には、ホーム画面の案内を出さない", async () => {
    await renderHome(homeFetch());
    await screen.findByTestId("btn-fetch");
    expect(screen.queryByTestId("home-screen-hint")).toBeNull();
  });

  it("「通知を受け取る」を押すと、公開値を読みに行く前に許可を問う（押した操作との結びつきを切らない）", async () => {
    const order: string[] = [];
    const registration = { pushManager: { getSubscription: async () => null, subscribe: async () => ({ toJSON: () => ({ endpoint: "https://push.example/1", keys: { p256dh: "p", auth: "a" } }) }) } };
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register: async () => registration, ready: Promise.resolve(registration) } });
    vi.stubGlobal("PushManager", function PushManager() {});
    const notification = {
      permission: "default" as NotificationPermission,
      requestPermission: async () => {
        order.push("ask");
        notification.permission = "granted";
        return "granted" as const;
      },
    };
    vi.stubGlobal("Notification", notification);
    let clicked = false;
    await renderHome(homeFetch({ kind: "active", reservation: reservationDto(), pushPromptDue: true }), {
      "GET /api/config/public": () => {
        if (clicked) order.push("config");
        return CONFIG();
      },
      "POST /api/customer/push-subscription": () => ({ json: { ok: true } }),
    });
    const allow = await screen.findByTestId("btn-push-allow");
    clicked = true;
    fireEvent.click(allow);
    await waitFor(() => expect(api!.calls.filter((c) => c.path === "/api/customer/push-subscription").length).toBeGreaterThanOrEqual(1));
    expect(order.slice(0, 2)).toEqual(["ask", "config"]);
  });
});

describe("manifest（客-04 の案C）", () => {
  it("客の画面をホーム画面のアプリとして開く記述で、指しているアイコンは追跡している SVG か、組み立てで作る PNG", async () => {
    const m = manifest();
    expect(m.start_url).toBe("/me");
    expect(m.display).toBe("standalone");
    expect(m.name).toBe("イマセキ");
    // PNG は追跡しない決まり（構造の検査 34.6）なので、組み立てのスクリプトが作る。作れる名前と大きさを確かめる
    const script = (await import(/* @vite-ignore */ pathToFileURL(path.join(__dirname, "..", "..", "scripts", "make-app-icons.mjs")).href)) as {
      ICONS: Array<[string, number]>;
      writeIcons: (dir: string) => void;
    };
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "imaseki-icons-"));
    script.writeIcons(out);
    const made = new Map(script.ICONS);
    for (const icon of m.icons ?? []) {
      if (icon.src.endsWith(".svg")) {
        expect(fs.existsSync(path.join(__dirname, "..", "..", "public", icon.src))).toBe(true);
        continue;
      }
      const name = icon.src.replace(/^\//, "");
      expect(made.has(name), name).toBe(true);
      const bytes = fs.readFileSync(path.join(out, name));
      expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
      // IHDR の幅（16〜19バイト目）が manifest の大きさと揃う
      expect(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(16)}`).toBe(icon.sizes);
    }
    expect(made.get("apple-touch-icon.png")).toBe(180);
  });
});
