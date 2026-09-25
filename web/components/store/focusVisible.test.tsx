// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any -- 偽の API の本文は、この検査の中だけで読む値（受け入れ検査の _fakes と同じ扱い） */
// キーボードで操作したとき、焦点が目に見えない所へ行かない（2026-09-25 監査の指摘 横断-06）。
//
// ダイヤルの裏の欄と、公開中のカードの1操作ずつの欄とボタンは、目には出さない（store-sr-only）が Tab で止まる。
// それまでは焦点が入っても見えないままで、画面を見ながらキーボードで操作する人は、焦点が消えたまま数字を打っていた。
// 焦点が入ったら見せる（store-sr-only--focusable）。見た目の側は tests/uiStyles.test.ts が CSS で確かめる。

import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { installFakeApi, offerDto, storeHomeDto, type FakeApi } from "../../../tests/acceptance/v2/_fakes";
import { PublishForm } from "./PublishForm";
import { StoreHome } from "./StoreHome";

let api: FakeApi | null = null;

afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
});

/** 焦点が止まる要素（Tab で入れるもの）。 */
const FOCUSABLE = "input:not([type=hidden]):not([disabled]), button:not([disabled]):not([tabindex='-1']), select, textarea, a[href]";

/** 目に出さない入れ物の中で Tab が止まる要素のうち、焦点が入っても見えないままのもの。 */
const hiddenFocusTraps = (root: HTMLElement): string[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)]
    .filter((el) => el.closest(".store-sr-only") !== null)
    .filter((el) => el.closest(".store-sr-only--focusable") === null)
    .map((el) => el.getAttribute("data-testid") ?? el.outerHTML.slice(0, 60));

describe("目に出さない欄とボタンは、焦点が入ったら見える（横断-06）", () => {
  it("公開のフォームのダイヤルの裏の欄（配信数・何名まで）", () => {
    const { container } = render(<PublishForm coupons={[]} prefill={{ couponIds: [], capacity: null, partyMax: null, until: null }} onPublished={() => undefined} />);
    expect(screen.getByTestId("field-capacity").closest(".store-sr-only--focusable")).not.toBeNull();
    expect(hiddenFocusTraps(container)).toEqual([]);
  });

  it("公開中のカードの1操作ずつの欄とボタン（追加・減らす・何名まで・何時まで）", async () => {
    api = installFakeApi({
      "GET /api/store/home": () => ({ json: storeHomeDto({ offer: offerDto() } as any) }),
      "GET /api/config/public": () => ({ json: { turnstileSiteKey: "s", vapidPublicKey: "v", contactEmail: null } }),
    });
    render(<StoreHome />);
    const card = await screen.findByTestId("offer-card");
    expect(card.querySelectorAll(".store-sr-only--focusable").length).toBeGreaterThanOrEqual(4);
    expect(hiddenFocusTraps(card)).toEqual([]);
  });
});
