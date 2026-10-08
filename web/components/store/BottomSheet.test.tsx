// @vitest-environment jsdom
// 下からのシート（2026-10-08 本人選択「案C 片手の親指」・同日のレビューの指摘）。
// 開いている間はモーダル: 背面に inert を付けて Tab で抜けさせない／Esc は焦点がどこにあっても閉じる／
// 閉じたら開いたボタンへ焦点を戻し、そのボタンが消えていたらシートを置いた場所の見出しへ戻す（body に落とさない）。

import React, { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BottomSheet } from "./BottomSheet";

afterEach(cleanup);

const Harness = ({ keepOpener = true }: { keepOpener?: boolean }) => {
  const [open, setOpen] = useState(false);
  return (
    <main>
      <h1>オファー</h1>
      <button type="button">背面のボタン</button>
      <section>
        <h2>公開中のオファー</h2>
        {keepOpener || !open ? (
          <button type="button" onClick={() => setOpen(true)}>
            開く
          </button>
        ) : null}
        <BottomSheet open={open} onClose={() => setOpen(false)} label="数を変える" testId="sheet" foot={<button type="button">更新する</button>}>
          <p>中身</p>
        </BottomSheet>
      </section>
    </main>
  );
};

describe("BottomSheet", () => {
  it("開くとシートへ焦点が移り、背面の兄弟に inert が付く。閉じると外れる", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "開く" }));
    const sheet = screen.getByTestId("sheet");
    expect(document.activeElement).toBe(sheet);
    expect(screen.getByRole("button", { name: "背面のボタン", hidden: true }).closest("[inert]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "開く", hidden: true }).closest("[inert]")).not.toBeNull();
    expect(sheet.closest("[inert]")).toBeNull();
    act(() => {
      fireEvent.keyDown(document.body, { key: "Escape" });
    });
    expect(screen.queryByTestId("sheet")).toBeNull();
    expect(document.querySelectorAll("[inert]")).toHaveLength(0);
  });

  it("焦点がシートの外にあっても Esc で閉じ、閉じたら開いたボタンへ焦点が戻る", () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "開く" });
    opener.focus();
    fireEvent.click(opener);
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByTestId("sheet")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "開く" }));
  });

  it("開いたボタンが閉じたときに消えていたら、シートを置いた場所の見出しへ焦点を戻す", () => {
    render(<Harness keepOpener={false} />);
    const opener = screen.getByRole("button", { name: "開く" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.queryByRole("button", { name: "開く", hidden: true })).toBeNull();
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "公開中のオファー" }));
  });

  it("閉じている keepMounted のシートには Esc を渡さない（開いていないシートは閉じる操作を受けない）", () => {
    let closed = 0;
    render(
      <BottomSheet open={false} onClose={() => (closed += 1)} label="その他の操作" keepMounted>
        <button type="button">キャンセル</button>
      </BottomSheet>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(closed).toBe(0);
    expect(screen.getByRole("button", { name: "キャンセル", hidden: true }).closest("[inert]")).not.toBeNull();
  });
});
