// @vitest-environment jsdom
// 客の登録の画面（自動の登録が通らなかったときの受け皿）の説明文（2026-09-25 監査の指摘 安全-16）。
//
// 前の版は「呼び名はお店に伝わりません。」と書いていたが、ここで入れた呼び名は受け取った店の一覧に
// 「◯◯ さん」と出る（基準 20.1）。客へ個人データの扱いを事実と違う形で説明しないことを固定する。
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PERSONAL_DATA_TEXTS } from "../../lib/domain/texts";
import { RegisterForm } from "./RegisterForm";

describe("客の登録の画面の説明（安全-16）", () => {
  const previous = globalThis.fetch;
  afterEach(() => {
    cleanup();
    globalThis.fetch = previous;
  });

  it("呼び名と電話番号が受け取ったお店の画面に出ると書き、「お店に伝わりません」とは書かない", () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false }), { status: 404 })) as typeof fetch;
    const { container } = render(<RegisterForm onRegistered={() => {}} />);
    expect(container.textContent).toContain(PERSONAL_DATA_TEXTS.registerNotice);
    expect(container.textContent).not.toMatch(/お店に伝わりません/);
  });
});
