"use client";

// 「右へすべらせて止める」（2026-10-08 本人選択「案C 片手の親指」の論点2）。トレーを持ったままでも、2つ目のボタンへ
// 指を動かさず、親指の横の動き1本で押し間違いを防ぐ。すべらせきるまでは何も起きず、途中で離すと戻る。
// キーボードでは、つまみに焦点を置いて右矢印を4回（左矢印か Esc で戻る）。
//
// ⚠️ すべらせる操作が難しい人のために、同じシートに「確かめて止める」の普通のボタンも置く（OfferPanel 側）。

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/** 右端の何割まで来たら「すべらせきった」とみなすか */
const DONE_RATIO = 0.92;
/** 右矢印で何回押せば右端へ届くか */
const KEY_STEPS = 4;
/** つまみの左右のすき間（CSS の .store-slide__knob の inset と同じ数） */
const KNOB_INSET_PX = 4;

type Props = {
  label: string;
  /** 読み上げの名前（キーボードの操作の仕方も入れる） */
  knobLabel: string;
  disabled?: boolean;
  onComplete: () => void;
};

export const SlideToStop = ({ label, knobLabel, disabled = false, onComplete }: Props) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{ startX: number; from: number } | null>(null);
  const [x, setX] = useState(0);
  const [snapping, setSnapping] = useState(false);

  const maxX = (): number => {
    const track = trackRef.current;
    const knob = knobRef.current;
    if (!track || !knob) return 0;
    return Math.max(0, track.clientWidth - knob.offsetWidth - KNOB_INSET_PX * 2);
  };
  const clamp = (value: number): number => Math.max(0, Math.min(maxX(), value));

  const finish = (at: number) => {
    setSnapping(true);
    const end = maxX();
    if (end > 0 && at >= end * DONE_RATIO) {
      setX(end);
      onComplete();
      return;
    }
    setX(0);
  };

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    dragRef.current = { startX: event.clientX, from: x };
    setSnapping(false);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (drag) setX(clamp(drag.from + event.clientX - drag.startX));
  };
  const onPointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    finish(x);
  };
  const onPointerCancel = () => {
    dragRef.current = null;
    setSnapping(true);
    setX(0);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setSnapping(true);
      const end = maxX();
      const next = clamp(x + end / KEY_STEPS + 1);
      setX(next);
      if (end > 0 && next >= end) finish(next);
    }
    if (event.key === "ArrowLeft" || event.key === "Escape") {
      if (x === 0) return;
      event.preventDefault();
      event.stopPropagation();
      setSnapping(true);
      setX(0);
    }
  };

  return (
    <div ref={trackRef} className={snapping ? "store-slide store-slide--snap" : "store-slide"} data-testid="slide-stop">
      <span className="store-slide__fill" style={{ width: `calc(${x}px + var(--store-slide-knob))` }} aria-hidden="true" />
      <span className="store-slide__text" aria-hidden="true">
        {label}
      </span>
      <button
        ref={knobRef}
        type="button"
        className="store-slide__knob"
        style={{ transform: `translateX(${x}px)` }}
        aria-label={knobLabel}
        disabled={disabled}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onKeyDown={onKeyDown}
        onTransitionEnd={() => setSnapping(false)}
      >
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
          <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
};

export default SlideToStop;
