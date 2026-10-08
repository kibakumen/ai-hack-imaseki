"use client";

// 下からのシート（2026-10-08 本人選択「案C 片手の親指」）。変えるもの・取り返せない操作の確かめを、親指の届く
// 画面の下から開く。上半分は読むだけにして、操作は下へ集める。
//
// ⚠️ `keepMounted` のシートは、閉じている間も中身を DOM に残す（`inert` で触れず・読み上げにも出ない）。
//    公開中のカードの欄とボタン（受け入れ検査が掴む `<form>`）と、確保ごとの「キャンセル」は、開く前から在る約束なので。
//    閉じたら DOM から消えてよいもの（「公開を止める」の確かめ）は `keepMounted` を付けない。
//
// 開いたらシートへ焦点を移し、閉じたら開いたボタンへ戻す。Esc と、シートの外（幕）を押すと閉じる。

import { useEffect, useRef, type ReactNode } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  /** 読み上げの名前（role=dialog の aria-label） */
  label: string;
  testId?: string;
  /** 閉じている間も中身を残す */
  keepMounted?: boolean;
  /** シートの底に貼り付く部分（主な操作）。親指にいちばん近い */
  foot?: ReactNode;
  children: ReactNode;
};

export const BottomSheet = ({ open, onClose, label, testId, keepMounted = false, foot, children }: Props) => {
  const sheetRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    // 中の部品が先に焦点を取っていれば（確かめの確定のボタンなど）、それを奪わない
    if (!sheetRef.current?.contains(document.activeElement)) sheetRef.current?.focus();
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, [open]);

  if (!open && !keepMounted) return null;

  return (
    <div className={open ? "store-sheet-layer store-sheet-layer--open" : "store-sheet-layer"} inert={!open}>
      <div className="store-sheet__scrim" aria-hidden="true" onClick={onClose} />
      <div
        ref={sheetRef}
        className="store-sheet"
        role="dialog"
        aria-modal={open}
        aria-label={label}
        data-testid={testId}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="store-sheet__handle" aria-hidden="true" />
        <div className="store-sheet__scroll">{children}</div>
        {foot ? <div className="store-sheet__foot">{foot}</div> : null}
      </div>
    </div>
  );
};

export default BottomSheet;
