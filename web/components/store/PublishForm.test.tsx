// @vitest-environment jsdom
// 公開のフォームの帯（2026-10-08 本人選択「案C 片手の親指」・同日のレビューの指摘）。
// ボタンの名前は「公開する」のまま変えず、決めていない数の残りは隣の文（aria-describedby）で言う。
// 帯の「終了タイマー」で欄を開いたら、欄へ焦点を移す（帯は画面の下、欄はフォームの途中にある）。

import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PublishForm } from "./PublishForm";

afterEach(cleanup);

const empty = { couponIds: [], capacity: null, partyMax: null, until: null };

describe("公開のフォームの帯", () => {
  it("ボタンの名前は「公開する」のまま。残りの数は隣の文で言い、決まると中身を復唱する", () => {
    render(<PublishForm coupons={[]} prefill={empty} onPublished={() => undefined} />);
    const publish = screen.getByRole("button", { name: "公開する" });
    const note = () => document.getElementById(publish.getAttribute("aria-describedby")!)!;
    expect(note().textContent).toBe("あと2つ決めると公開できます");
    fireEvent.click(screen.getByRole("button", { name: "配信数を 3組にする" }));
    expect(note().textContent).toBe("あと1つ決めると公開できます");
    fireEvent.click(screen.getByRole("button", { name: "何名までを 4名にする" }));
    expect(note().textContent).toBe("3組・4名までで公開します");
    expect(screen.getByRole("button", { name: "公開する" })).toBe(publish);
  });

  it("帯の「終了タイマー」で開くと、何時に終わるかの欄へ焦点が移る", () => {
    render(<PublishForm coupons={[]} prefill={empty} onPublished={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: /終了タイマー/ }));
    expect(document.activeElement).toBe(screen.getByTestId("field-until"));
  });
});
