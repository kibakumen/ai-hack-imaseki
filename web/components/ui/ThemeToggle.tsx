"use client";

// 明暗の切り替えボタン（2026-09-22 本人の指摘「システムなどの設定に縛られずに切り替えたい」）。
// 3つの画面（客・店・運営）の殻（`app/*/layout.tsx`）から呼ぶ——画面の主役ではないので、
// 部品自身は控えめな見た目だけを持つ。色の値は持たない（`app/globals.css` の `.theme-toggle` が持つ・
// 構造の検査 32.3 が .tsx の色の値を見張るため）。
//
// 状態は3つ: 明るい・暗い・端末に合わせる（既定）。選択は <html data-theme> と localStorage に置く。
// 最初のちらつきは `app/layout.tsx` の <head> の同期スクリプトが防ぐ——このボタンはその結果
// （DOM の属性）を読むだけで、二重の判定ロジックを持たない。
//
// 読み方は useSyncExternalStore にする（useEffect の中で setState する形にしない）——
// <html> の属性はこのタブの外（同期スクリプト・別タブでの選択）でも変わりうる「外部の状態」で、
// これを React の状態へ写すのがこの hook の設計目的そのもの。サーバ側の値（getServerSnapshot）を
// 「端末に合わせる」に決めておけるので、水和の食い違いも起きない。

import { useSyncExternalStore } from "react";

type ThemeChoice = "light" | "dark" | "system";

const STORAGE_KEY = "theme-choice";
// 押すたびに この順で進む（既定の「端末に合わせる」から始めて、明るい→暗い→端末に戻る）。
const ORDER: ThemeChoice[] = ["system", "light", "dark"];
const LABEL: Record<ThemeChoice, string> = {
  system: "端末に合わせる",
  light: "明るい配色",
  dark: "暗い配色",
};
const MARK: Record<ThemeChoice, string> = {
  system: "🌓",
  light: "☀️",
  dark: "🌙",
};

/** 今の選択を <html data-theme> から読む（localStorage を別に読むと2つの真実ができるため、
 * 表示に使う値は必ずこの属性から読む）。 */
const getSnapshot = (): ThemeChoice => {
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "light" || attr === "dark" ? attr : "system";
};

/** サーバ側では <html> も localStorage も無いので、既定の「端末に合わせる」を返す。 */
const getServerSnapshot = (): ThemeChoice => "system";

/** <html> の属性は apply() でしか変わらないので、変わったことを知らせるのは apply() 自身
 * （下の notify）。複数の画面にこのボタンが同時に載っても（客・店・運営を別タブで開く等）
 * 正しく揃うよう、購読者は Set で持つ。 */
const listeners = new Set<() => void>();
const notify = (): void => {
  for (const listener of listeners) listener();
};
const subscribe = (onStoreChange: () => void): (() => void) => {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
};

const apply = (choice: ThemeChoice): void => {
  if (choice === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", choice);
  try {
    if (choice === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // プライベートウィンドウ等では例外が飛ぶ。表示の切り替え自体は続ける（次に開いたときは既定に戻るだけ）。
  }
  notify();
};

export const ThemeToggle = () => {
  const choice = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const next = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length];

  return (
    <button
      type="button"
      className="theme-toggle"
      data-testid="theme-toggle"
      aria-label={`配色: ${LABEL[choice]}。押すと${LABEL[next]}に切り替える`}
      onClick={() => apply(next)}
    >
      <span aria-hidden="true">{MARK[choice]}</span>
    </button>
  );
};

export default ThemeToggle;
