// @vitest-environment jsdom
// 店の登録の画面が「このメールアドレスは登録済みです。」を出すこと（要件12の基準 12.2）。
//
// ⚠️ **なぜ単体の検査を置いたか**（2026-09-22 タスク25）: 受け入れ検査 `r12-store-register.ui.test.tsx` は
// メールアドレスの欄の下に文の要素（`msg-email`）が在ることだけを見るので、**中身が別の文でも通る**。
// 実際、入口は 409 で登録済みの語と `fields: [{ email, not_allowed }]` を返しているのに、画面には
// 「メールアドレスは選択肢から選んでください。」（理由 not_allowed の文）が出ていた
// ——項目の出し口は理由の文しか描かず、操作の出し口は「この項目の断りが在る」と何も描かないため、
// 語の文がどちらの経路からも出なかった（タスク4の監査の反論役が見つけた指摘）。
// 文言まで見る検査はここにしか置けないので、ここで固定する。

import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TEXTS } from "../../lib/domain/texts";
import { RegisterForm } from "./RegisterForm";

type FakeResponse = { status?: number; json: unknown };

const installFetch = (respond: (path: string) => FakeResponse) => {
  const previous = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://localhost").pathname;
    const out = respond(path);
    return new Response(JSON.stringify(out.json), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = previous;
  };
};

let restore: (() => void) | null = null;

afterEach(() => {
  cleanup();
  restore?.();
  restore = null;
});

const fillAndSubmit = () => {
  fireEvent.change(screen.getByTestId("field-name"), { target: { value: "検査の店" } });
  fireEvent.change(screen.getByTestId("field-email"), { target: { value: "dup@example.com" } });
  fireEvent.change(screen.getByTestId("field-password"), { target: { value: "store-pass-1234" } });
  fireEvent.click(screen.getByTestId("btn-register"));
};

describe("店の登録の断りの文", () => {
  it("登録済みのメールアドレスでは、欄の直下に語の文が出る（理由の文ではない）", async () => {
    restore = installFetch((path) =>
      path === "/api/config/public"
        ? { json: { turnstileSiteKey: "site-key-test", vapidPublicKey: "vapid", contactEmail: null } }
        : { status: 409, json: { ok: false, error: { kind: "email_taken", fields: [{ name: "email", reason: "not_allowed" }] } } },
    );
    render(<RegisterForm />);
    await screen.findByTestId("field-name");
    fillAndSubmit();
    const message = await screen.findByTestId("msg-email");
    expect(message.textContent).toBe(TEXTS.inputRefusal("email_taken"));
    expect(message.textContent).not.toBe(TEXTS.fieldReason("not_allowed", { field: "メールアドレス" }));
  });

  it("形の誤りのときは、今までどおり理由の文が出る（語の文で上書きしない）", async () => {
    restore = installFetch((path) =>
      path === "/api/config/public"
        ? { json: { turnstileSiteKey: "site-key-test", vapidPublicKey: "vapid", contactEmail: null } }
        : { status: 400, json: { ok: false, error: { kind: "invalid_input", fields: [{ name: "email", reason: "bad_format" }] } } },
    );
    render(<RegisterForm />);
    await screen.findByTestId("field-name");
    fillAndSubmit();
    const message = await screen.findByTestId("msg-email");
    await waitFor(() => expect(message.textContent).toBe(TEXTS.fieldReason("bad_format", { field: "メールアドレス", hint: "メールアドレスの形" })));
  });
});
