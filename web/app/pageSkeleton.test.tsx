// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any -- 偽の API の本文は、この検査の中だけで読む値（受け入れ検査の _fakes と同じ扱い） */
// 画面の骨組み（2026-09-25 監査の指摘 横断-12）。
//
// それまでページ名は全画面「イマセキ」だけで、ブラウザのタブや履歴で見分けられなかった。/me・店舗情報・書類・
// パスワード・店の登録には h1 が無く、/store/password には戻る道（タブ）が無かった。
// 見るのは: ①どのページも自分の名前を持ち、名前は重ならない ②どの画面も h1 を1つ持つ（読み込みに失敗しても）
// ③店の画面は、タブ（StoreNav）が見出しの前に来る ④仮のパスワードの店にはタブを出さない（決めるまで使えない・安全-21）。

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { homeFetch, installFakeApi, storeHomeDto, type FakeApi } from "../../tests/acceptance/v2/_fakes";
import { metadata as rootMetadata } from "./layout";
import CustomerPage from "./me/page";
import StoreDocumentsPage from "./store/documents/page";
import StorePasswordPage from "./store/password/page";
import StoreProfilePage from "./store/profile/page";
import StoreRegisterPage from "./store/register/page";

vi.mock("next/navigation", () => ({ usePathname: () => null, useRouter: () => ({ push: () => undefined, replace: () => undefined }) }));

let api: FakeApi | null = null;
afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
});

const APP = __dirname;
const pages = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "api" ? [] : pages(p);
    return entry.name === "page.tsx" ? [p] : [];
  });

const CONFIG = () => ({ json: { turnstileSiteKey: "", vapidPublicKey: "v", contactEmail: null } });

/** 見出しが1つだけで、その前にタブが在れば、タブが見出しより前に並んでいること */
const expectSingleH1 = (): HTMLHeadingElement => {
  const headings = document.querySelectorAll("h1");
  expect(headings, "h1 はちょうど1つ").toHaveLength(1);
  return headings[0];
};
const expectNavBeforeHeading = () => {
  const nav = document.querySelector(".store-tabs");
  expect(nav, "店のタブ（StoreNav）が無い").not.toBeNull();
  const h1 = expectSingleH1();
  expect(nav!.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING, "タブが見出しより後にある").toBeTruthy();
};

describe("ページ名（横断-12）", () => {
  it("全体の殻は「◯◯ | イマセキ」の雛形を持つ", () => {
    const title = rootMetadata.title as { default?: string; template?: string };
    expect(title.default).toBe("イマセキ");
    expect(title.template).toBe("%s | イマセキ");
  });

  it("入口（/）のほかの全部のページが、自分の名前を持ち、名前は重ならない", async () => {
    const titles = new Map<string, string>();
    for (const file of pages(APP)) {
      const route = "/" + path.relative(APP, path.dirname(file)).split(path.sep).join("/");
      if (route === "/") continue;
      const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as { metadata?: { title?: unknown } };
      const title = mod.metadata?.title;
      expect(typeof title, `${route} にページ名が無い`).toBe("string");
      expect(title as string, `${route} のページ名に雛形の「| イマセキ」を重ねない`).not.toMatch(/イマセキ/);
      expect([...titles.values()], `${route} の名前「${title}」がほかのページと重なる`).not.toContain(title);
      titles.set(route, title as string);
    }
    expect(titles.size).toBeGreaterThanOrEqual(15);
  });
});

describe("h1 とタブの並び（横断-12）", () => {
  it("客の画面（/me）は、登録の入力のときも取得の画面のときも h1 を1つ持つ", async () => {
    api = installFakeApi({ "GET /api/config/public": CONFIG, "GET /api/customer/home": () => ({ json: homeFetch() }), "POST /api/register/customer": () => ({ status: 429, json: { ok: false, error: { kind: "rate_limited" } } }) });
    render(<CustomerPage />);
    await screen.findByTestId("btn-fetch");
    expectSingleH1();
  });

  it("店舗情報は、読み込みに失敗しても「店舗情報」の h1 とタブを出す（タブが先）", async () => {
    api = installFakeApi({ "GET /api/store/profile": () => ({ status: 500, json: { ok: false, error: { kind: "internal" } } }) });
    render(<StoreProfilePage />);
    await screen.findByTestId("load-failed");
    expect(expectSingleH1().textContent).toBe("店舗情報");
    expectNavBeforeHeading();
  });

  it("書類は「書類」の h1（タブが先）", async () => {
    api = installFakeApi({ "GET /api/store/home": () => ({ json: storeHomeDto({ status: "pending" }) }) });
    render(<StoreDocumentsPage />);
    await screen.findByTestId("license-status");
    expect(expectSingleH1().textContent).toBe("書類");
    expectNavBeforeHeading();
  });

  it("パスワードの画面は、自分で変えに来た店にはタブ（戻る道）と h1 を出し、仮のパスワードの店の文を出さない", async () => {
    api = installFakeApi({ "GET /api/store/home": () => ({ json: storeHomeDto({ status: "approved", mustChangePassword: false } as any) }) });
    render(<StorePasswordPage />);
    await screen.findByTestId("form-password");
    expect(expectSingleH1().textContent).toMatch(/パスワード/);
    expectNavBeforeHeading();
    expect(document.body.textContent).not.toMatch(/仮のパスワード/);
  });

  it("パスワードの画面は、仮のパスワードで来た店にはタブを出さない（決めるまでほかの画面は使えない・安全-21）", async () => {
    api = installFakeApi({ "GET /api/store/home": () => ({ json: storeHomeDto({ status: "approved", mustChangePassword: true } as any) }) });
    render(<StorePasswordPage />);
    await screen.findByTestId("form-password");
    expectSingleH1();
    expect(document.querySelector(".store-tabs")).toBeNull();
    expect(document.body.textContent).toMatch(/仮のパスワード/);
  });

  it("店の登録は h1 を1つ持つ", async () => {
    api = installFakeApi({ "GET /api/config/public": CONFIG });
    render(<StoreRegisterPage />);
    expect(expectSingleH1().textContent).toMatch(/登録/);
  });
});
