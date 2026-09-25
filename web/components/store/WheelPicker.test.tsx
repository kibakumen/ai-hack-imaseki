// @vitest-environment jsdom
// 数のダイヤル（2026-09-25 監査の指摘 店-04 の案A）。
//
// 初めて公開する店（前回のオファーが無い）では初めの値が空になる（要件17の基準 17.21）。それまでのダイヤルは
// 空欄も目盛りの0番目（=1）として大きく目立たせて描き、▲は押せなかった。そのまま「公開する」を押すと
// 「配信数を入れてください」と断られ、1 を選ぶには▼で2にしてから戻すしかなかった。
// 空欄は「—」で出し、▲か▼を押したら最小値に入る。**プログラムが位置を合わせ直すスクロールでは値を決めない**。

import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Wheel } from "./WheelPicker";

const ITEM = 44;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const renderWheel = (value: string, onChange = vi.fn()) => {
  const view = render(<Wheel min={1} max={20} value={value} onChange={onChange} unit="組" />);
  const window = view.container.querySelector(".store-dial__window") as HTMLElement;
  const rail = view.container.querySelector(".store-dial__rail") as HTMLElement;
  const [up, down] = [...view.container.querySelectorAll("button")] as HTMLButtonElement[];
  return { ...view, window, rail, up, down, onChange };
};

describe("Wheel（空欄）", () => {
  it("空欄のときは、どの目盛りも選ばれた印を持たず「—」を出す。▲も▼も押せる", () => {
    const { window, up, down } = renderWheel("");
    expect(window.querySelector(".store-dial__item--on")).toBeNull();
    expect(window.textContent).toContain("—");
    expect(up.disabled).toBe(false);
    expect(down.disabled).toBe(false);
  });

  it("空欄で▲を押しても▼を押しても、最小値（1）に入る", () => {
    const first = renderWheel("");
    fireEvent.click(first.up);
    expect(first.onChange).toHaveBeenLastCalledWith("1");
    cleanup();
    const second = renderWheel("");
    fireEvent.click(second.down);
    expect(second.onChange).toHaveBeenLastCalledWith("1");
  });

  it("値が入っているときは、その目盛りに印が付き「—」は出ない", () => {
    const { window } = renderWheel("3");
    expect(window.querySelector(".store-dial__item--on")?.textContent).toBe("3");
    expect(window.textContent).not.toContain("—");
  });
});

describe("Wheel（プログラムが位置を合わせ直すスクロールでは値を決めない）", () => {
  it("人が触っていないスクロール（初めの位置合わせ・外からの値の変化）では onChange を呼ばない", () => {
    const { rail, onChange } = renderWheel("");
    rail.scrollTop = 0;
    fireEvent.scroll(rail);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("値が入っていて外から変わったときの寄せ直しでも onChange を呼ばない", () => {
    const onChange = vi.fn();
    const { rail, rerender } = renderWheel("5", onChange);
    rerender(<Wheel min={1} max={20} value="21" onChange={onChange} unit="組" />);
    rail.scrollTop = 19 * ITEM;
    fireEvent.scroll(rail);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("指で回したスクロールは、止まった目盛りの値に決まる", () => {
    const { rail, onChange } = renderWheel("");
    fireEvent.pointerDown(rail);
    rail.scrollTop = 3 * ITEM;
    fireEvent.scroll(rail);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onChange).toHaveBeenLastCalledWith("4");
  });
});
