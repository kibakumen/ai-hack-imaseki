// @vitest-environment jsdom
// 「右へすべらせて止める」のキーボードの操作（2026-10-08 のレビューの指摘）。
// つまみはスライダーとして名乗り、右矢印4回で1回だけ止める。押しっぱなしの繰り返しは数えない。
// 幅が測れない（0）ときも4回で止まる。左矢印・Esc は戻すだけで、外（シートの Esc）へ渡さない。

import React from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SlideToStop } from "./SlideToStop";

afterEach(cleanup);

const renderSlide = () => {
  const onComplete = vi.fn();
  render(<SlideToStop label="右へすべらせて止める" knobLabel="右へすべらせて公開を止める（キーボードは右矢印を4回）" onComplete={onComplete} />);
  const knob = screen.getByRole("slider", { name: /公開を止める/ });
  return { knob, onComplete };
};

describe("SlideToStop", () => {
  it("右矢印を4回押すと onComplete が1回だけ呼ばれる（幅が0でも）。5回目でもう呼ばれない", () => {
    const { knob, onComplete } = renderSlide();
    for (let i = 0; i < 3; i += 1) fireEvent.keyDown(knob, { key: "ArrowRight" });
    expect(onComplete).not.toHaveBeenCalled();
    expect(knob.getAttribute("aria-valuenow")).toBe("3");
    fireEvent.keyDown(knob, { key: "ArrowRight" });
    fireEvent.keyDown(knob, { key: "ArrowRight" });
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("押しっぱなしの繰り返し（repeat）は数えない", () => {
    const { knob, onComplete } = renderSlide();
    fireEvent.keyDown(knob, { key: "ArrowRight" });
    for (let i = 0; i < 10; i += 1) fireEvent.keyDown(knob, { key: "ArrowRight", repeat: true });
    expect(knob.getAttribute("aria-valuenow")).toBe("1");
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("Enter と Space では止まらない。Esc は戻すだけで、外へは既定の動きを止めたことを伝える", () => {
    const { knob, onComplete } = renderSlide();
    fireEvent.keyDown(knob, { key: "Enter" });
    fireEvent.keyDown(knob, { key: " " });
    expect(onComplete).not.toHaveBeenCalled();
    fireEvent.keyDown(knob, { key: "ArrowRight" });
    const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    act(() => {
      knob.dispatchEvent(escape);
    });
    expect(escape.defaultPrevented).toBe(true);
    expect(knob.getAttribute("aria-valuenow")).toBe("0");
  });
});
