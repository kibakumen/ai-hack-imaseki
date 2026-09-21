"use client";

// 数をダイヤルで選ぶ欄（2026-09-21 の本人の指摘「配信数・何名までは、スマホのアラームのような
// ダイヤルで選びたい」）。速成版 `sprint/app/store/_components/WheelPicker.tsx` の形を移した。
// 外部の部品は足さず、CSS の scroll-snap だけで作る——中央に来た値が選ばれた値。
//
// ⚠️ **本当の入力欄は消さずに裏へ残す**。目に見えるのはダイヤルだが、DOM には `data-testid` を持つ
//    `<input>` がそのまま在り、打った文字がそのまま値になる（丸めない・範囲へ寄せない）。
//    こうしてある理由は2つ:
//      1. 入口が「1〜20の数で入れてください」と断ったとき、**店が入れた値を消さずに残す**という
//         決まり（設計書「入力の誤りの出し方」の規則3）を守れる。ダイヤルの目盛りへ丸めると、
//         21 と入れて断られた人の画面が 20 に化けてしまう
//      2. キーボードと読み上げの利用者が、ダイヤルを回さずに数を打てる（目には出さないだけ）
//
// ⚠️ 中央へ寄せるのは `scrollTop` への代入で行う（`scrollTo` は環境によって持っていない）。
//    滑らかさは CSS の `scroll-behavior` が持つ。

import { useEffect, useRef, type ChangeEvent, type CSSProperties } from "react";

/**
 * 目盛り1つの高さ。**この数は CSS にも要る**（窓の高さ・上下の余白・中央の枠がこれで決まる）ので、
 * 写しを置かずに custom property で渡す——`store.css` は `var(--store-dial-item)` を読む。
 * 2つに書くと、片方だけ直したときに中央がずれて、気づきにくい壊れ方をする。
 */
const ITEM_HEIGHT_PX = 32;
const ITEM_HEIGHT_VAR = { "--store-dial-item": `${ITEM_HEIGHT_PX}px` } as CSSProperties;
/** スクロールが止まってから選んだ値を決めるまでの待ち時間 */
const COMMIT_DELAY_MS = 120;

type Props = {
  /** 受け入れ検査の約束の名前（`field-capacity` など） */
  testId: string;
  inputId: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  /** 打った文字そのまま（数に直さない） */
  value: string;
  onChange: (next: string) => void;
};

/** 目盛りの並び（min から max まで1つ刻み）。 */
const optionsOf = (min: number, max: number): number[] => Array.from({ length: max - min + 1 }, (_, i) => min + i);

/** 値が目盛りのどこに当たるか。空欄や範囲の外は、いちばん近い目盛りを指す。 */
const indexOf = (options: number[], value: string): number => {
  const n = Number(value);
  if (value.trim() === "" || Number.isNaN(n)) return 0;
  const exact = options.indexOf(n);
  if (exact >= 0) return exact;
  return n < options[0] ? 0 : options.length - 1;
};

export const WheelPicker = ({ testId, inputId, label, unit, min, max, value, onChange }: Props) => {
  const options = optionsOf(min, max);
  const railRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollingRef = useRef(false);
  const selected = indexOf(options, value);

  // 外から値が変わったとき（初めの値・入口からの取り直し・キーボード入力）だけ中央へ寄せる。
  // 指で回している間は割り込まない。
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || scrollingRef.current) return;
    rail.scrollTop = selected * ITEM_HEIGHT_PX;
  }, [selected]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const handleScroll = () => {
    scrollingRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      scrollingRef.current = false;
      const rail = railRef.current;
      if (!rail) return;
      const index = Math.min(options.length - 1, Math.max(0, Math.round(rail.scrollTop / ITEM_HEIGHT_PX)));
      // ⚠️ **上の useEffect が自分で寄せたぶんで値を書き換えない**。止まった先が今指している目盛りと
      //    同じなら、動かした人は居ない（外から寄せただけ）ので何もしない。
      //    これが無いと、21 と打って断られた店の画面が、寄せ直したときに 20 へ化ける
      //    （＝入れた内容を消さない決まりを、この部品が破る）。jsdom は本物のスクロールを
      //    持たないので**受け入れ検査では出ない壊れ方**。空欄のときだけは、指で回して
      //    いちばん小さい目盛りを選べるように、この見送りをしない。
      if (value !== "" && index === selected) return;
      const next = options[index];
      if (next !== undefined && String(next) !== value) onChange(String(next));
    }, COMMIT_DELAY_MS);
  };

  const handleInput = (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value);

  return (
    <div className="store-dial">
      <label className="store-dial__label" htmlFor={inputId}>
        {label}
      </label>
      {/* ⚠️ ダイヤルは**指で回すための見た目**なので読み上げからは外す（`aria-hidden`）。
          読み上げとキーボードに答えるのは下の `<input>` の方——そちらは label と結びついていて、
          上下キーで数を動かせる。ダイヤルに listbox を名乗らせると、焦点の面倒を見ていないのに
          「選べる一覧」だと約束してしまう。 */}
      <div className="store-dial__window" style={ITEM_HEIGHT_VAR} aria-hidden="true">
        <div className="store-dial__rail" ref={railRef} onScroll={handleScroll}>
          {options.map((option) => (
            <div key={option} className={options[selected] === option ? "store-dial__item store-dial__item--on" : "store-dial__item"}>
              {option}
            </div>
          ))}
        </div>
        <div className="store-dial__marker" />
      </div>
      <span className="store-dial__unit">{unit}</span>
      <input
        id={inputId}
        data-testid={testId}
        className="store-sr-only"
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={handleInput}
      />
    </div>
  );
};

export default WheelPicker;
