// @vitest-environment jsdom
// カードの登録の自動の確かめを絞る（2026-09-25 カード登録の自動の確かめのレビュー）。
//
// それまでは、登録を始めて入力を終えなかった店が、ホームや書類の画面を開くたびに確かめを送っていた。確かめは開始と
// 同じ回数の制限（10分に10回）で数えるので、開くだけで使い切り、本当に押した「カードを登録する」や、戻ってきたあとの
// 確かめまで断られた。今は——
//   - 決済会社の画面から戻ってきた印（`?card=returned`）があれば、いつでも送る
//   - 印が無いときの自動の確かめは、ホームと書類の画面を合わせて**1つのブラウザのセッションで1回だけ**
//   - 「カードを登録する」を押してやり直したら、また1回送れる

import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installFakeApi, refusal, storeHomeDto, type FakeApi } from "../../../tests/acceptance/v2/_fakes";
import { resetAutoConfirmTurn, takeAutoConfirmTurn } from "./cardReturn";
import { DocumentsPanel } from "./DocumentsPanel";
import { StoreHome } from "./StoreHome";

let api: FakeApi | null = null;

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
  window.history.replaceState({}, "", "/");
});

/** 登録を始めて入力を終えていない店（確かめは通らない） */
const install = () => {
  api = installFakeApi({
    "GET /api/store/home": () => ({ json: storeHomeDto({ status: "pending", checklist: { license: true, card: false }, cardSetupPending: true }) }),
    "GET /api/config/public": () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } }),
    "POST /api/store/card/confirm": () => refusal("card_setup_failed"),
  });
};

const confirms = () => api!.calls.filter((c) => c.path === "/api/store/card/confirm").length;
/** 自動の確かめが送られるなら、読み込みのあとに届く。送られないことを見るために少し待つ */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

const openDocuments = async () => {
  render(<DocumentsPanel />);
  await screen.findByTestId("card-status");
  await settle();
};

const openHome = async () => {
  render(<StoreHome />);
  await screen.findByTestId("arrivals");
  await settle();
};

describe("カードの登録の自動の確かめ", () => {
  it("戻ってきた印が無ければ、ホームと書類の画面を何度開いても、1つのブラウザのセッションで1回だけ送る", async () => {
    install();
    await openDocuments();
    await waitFor(() => expect(confirms()).toBe(1));
    cleanup();
    await openDocuments();
    cleanup();
    await openHome();
    cleanup();
    await openHome();
    expect(confirms()).toBe(1);
  });

  it("決済会社の画面から戻ってきた印があれば、自動の確かめを使ったあとでも送る", async () => {
    install();
    await openHome();
    await waitFor(() => expect(confirms()).toBe(1));
    cleanup();
    window.history.replaceState({}, "", "/store/documents?card=returned");
    await openDocuments();
    await waitFor(() => expect(confirms()).toBe(2));
  });

  it("やり直し（カードを登録する）のあとは、また1回だけ送れる", () => {
    expect(takeAutoConfirmTurn()).toBe(true);
    expect(takeAutoConfirmTurn()).toBe(false);
    resetAutoConfirmTurn();
    expect(takeAutoConfirmTurn()).toBe(true);
    expect(takeAutoConfirmTurn()).toBe(false);
  });
});
