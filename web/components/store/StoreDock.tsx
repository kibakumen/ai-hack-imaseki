"use client";

// 画面の下に貼り付く操作の帯（2026-10-08 本人選択「案C 片手の親指」）。下のナビのすぐ上に固定する。
//
// 帯の高さは中身で変わる（断りの文・承認待ちの説明・ボタンの折り返し）。固定の高さで main の下をあけると、
// 帯が高くなったときに最後のカードやメールの確認の案内が帯の下に隠れた（2026-10-08 のレビューの指摘）。
// そこで帯の実際の高さを測り、置かれた main に `--st-dock-h` として渡す（store.css が main の下の余白に使う）。

import { useEffect, useRef, type ReactNode } from "react";

type Props = { className?: string; children: ReactNode };

export const StoreDock = ({ className, children }: Props) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dock = ref.current;
    const main = dock?.closest<HTMLElement>("main");
    if (!dock || !main) return;
    const apply = () => main.style.setProperty("--st-dock-h", `${dock.getBoundingClientRect().height}px`);
    apply();
    if (typeof ResizeObserver === "undefined") return () => main.style.removeProperty("--st-dock-h");
    const observer = new ResizeObserver(apply);
    observer.observe(dock);
    return () => {
      observer.disconnect();
      main.style.removeProperty("--st-dock-h");
    };
  }, []);

  return (
    <div ref={ref} className={className ? `store-dock ${className}` : "store-dock"}>
      {children}
    </div>
  );
};

export default StoreDock;
