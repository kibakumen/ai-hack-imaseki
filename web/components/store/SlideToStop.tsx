"use client";

// 「右へすべらせて止める」（2026-10-08 本人選択「案C 片手の親指」の論点2）。トレーを持ったままでも、2つ目のボタンへ
// 指を動かさず、親指の横の動き1本で押し間違いを防ぐ。すべらせきるまでは何も起きず、途中で離すと戻る。
// キーボードでは、つまみに焦点を置いて右矢印を4回（左矢印か Esc で戻る）。
//
// ⚠️ すべらせる操作が難しい人のために、同じシートに「確かめて止める」の普通のボタンも置く（OfferStopSheet 側）。
//
// つまみは押すボタンではなく**スライダー**として名乗る（role=slider・2026-10-08 のレビューの指摘）。Enter・Space では
// 何も起きないので、ボタンを名乗ると押せば止まると約束してしまう。値は「右矢印を何回押したか」（0〜4）。
// キーボードの段は画面の幅に頼らない（幅が測れない＝0 でも4回で止まる）。押しっぱなしの繰り返しは数えない
// （一瞬で止まらないように）。

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/** 右端の何割まで来たら「すべらせきった」とみなすか */
const DONE_RATIO = 0.92;
/** 右矢印で何回押せば止まるか */
const KEY_STEPS = 4;
/** つまみの左右のすき間（CSS の .store-slide__knob の left と同じ数） */
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
  const knobRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startX: number; from: number } | null>(null);
  const doneRef = useRef(false);
  const [x, setX] = useState(0);
  const [steps, setSteps] = useState(0);
  const [snapping, setSnapping] = useState(false);

  const maxX = (): number => {
    const track = trackRef.current;
    const knob = knobRef.current;
    if (!track || !knob) return 0;
    return Math.max(0, track.clientWidth - knob.offsetWidth - KNOB_INSET_PX * 2);
  };
  const clamp = (value: number): number => Math.max(0, Math.min(maxX(), value));

  /** 止めたことを1回だけ知らせる */
  const complete = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    onComplete();
  };

  const reset = () => {
    setSnapping(true);
    setX(0);
    setSteps(0);
  };

  const finish = (at: number) => {
    setSnapping(true);
    const end = maxX();
    if (end > 0 && at >= end * DONE_RATIO) {
      setX(end);
      complete();
      return;
    }
    setX(0);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    dragRef.current = { startX: event.clientX, from: x };
    setSnapping(false);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (drag) setX(clamp(drag.from + event.clientX - drag.startX));
  };
  const onPointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    finish(x);
  };
  /** 指が外れた・取り上げられた（通知が割り込んだ など）——すべらせた途中なら戻す */
  const onPointerAbort = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    reset();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      if (event.repeat) return;
      const next = Math.min(KEY_STEPS, steps + 1);
      setSteps(next);
      setSnapping(true);
      setX((maxX() * next) / KEY_STEPS);
      if (next >= KEY_STEPS) complete();
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "Escape") {
      if (steps === 0 && x === 0) return;
      // 戻すだけ（シートを閉じる Esc に渡さない）
      event.preventDefault();
      reset();
    }
  };

  return (
    <div ref={trackRef} className={snapping ? "store-slide store-slide--snap" : "store-slide"} data-testid="slide-stop">
      <span className="store-slide__fill" style={{ width: `calc(${x}px + var(--store-slide-knob))` }} aria-hidden="true" />
      <span className="store-slide__text" aria-hidden="true">
        {label}
      </span>
      <div
        ref={knobRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        className="store-slide__knob"
        style={{ transform: `translateX(${x}px)` }}
        aria-label={knobLabel}
        aria-valuemin={0}
        aria-valuemax={KEY_STEPS}
        aria-valuenow={steps}
        aria-valuetext={steps >= KEY_STEPS ? "止めます" : `止めるまで右矢印あと ${KEY_STEPS - steps} 回`}
        aria-disabled={disabled || undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerAbort}
        onLostPointerCapture={onPointerAbort}
        onKeyDown={onKeyDown}
        onTransitionEnd={() => setSnapping(false)}
      >
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
          <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </div>
  );
};

export default SlideToStop;
