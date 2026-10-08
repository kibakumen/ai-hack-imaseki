"use client";

// 下からのシート（2026-10-08 本人選択「案C 片手の親指」）。変えるもの・取り返せない操作の確かめを、親指の届く
// 画面の下から開く。上半分は読むだけにして、操作は下へ集める。
//
// ⚠️ `keepMounted` のシートは、閉じている間も中身を DOM に残す（`inert` で触れず・読み上げにも出ない）。
//    公開中のカードの欄とボタン（受け入れ検査が掴む `<form>`）と、確保ごとの「キャンセル」は、開く前から在る約束なので。
//    閉じたら DOM から消えてよいもの（「公開を止める」の確かめ）は `keepMounted` を付けない。
//
// 開いている間はモーダルとして振る舞う（2026-10-08 のレビューの指摘）:
//   - シートの外の兄弟（シートから body までの各段の兄弟）に `inert` を付け、Tab で背面へ抜けないようにする。
//     付けたものだけを閉じたときに外す（もとから inert の要素＝閉じている別のシートには触らない）
//   - Esc は document の keydown で受ける（焦点がシートの外にあっても閉じられる）
//   - 開いたらシートへ焦点を移し、閉じたら開いたボタンへ戻す。そのボタンが消えていたら、シートを置いた場所の
//     見出し・押せる部品へ戻す（焦点を body に落とさない）
//
// 置き場所は描いた部品の中のまま（portal にしない）。確保のカードの中のシートを、受け入れ検査が `within(カード)` で引くため。
// そのため、シートの祖先に transform を持たせないこと（position: fixed がその中に閉じ込められる）。

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

const FOCUSABLE = "h1, h2, h3, button:not([disabled]), a[href], input:not([disabled]), [tabindex]";

/** シートから body までの各段の兄弟に inert を付け、付けたものを返す */
const inertOutside = (layer: HTMLElement): HTMLElement[] => {
  const marked: HTMLElement[] = [];
  for (let node: HTMLElement | null = layer; node && node !== document.body; node = node.parentElement) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) break;
    for (const sibling of Array.from<Element>(parent.children)) {
      // 属性で付ける（inert のプロパティを持たない環境でも同じに効く）
      if (sibling === node || !(sibling instanceof HTMLElement) || sibling.hasAttribute("inert")) continue;
      sibling.setAttribute("inert", "");
      marked.push(sibling);
    }
  }
  return marked;
};

/** 戻し先が消えていたときの代わり——シートを置いた場所の中の見出しか押せる部品（シートの外のもの） */
const fallbackFocus = (anchor: HTMLElement | null, layer: HTMLElement | null): HTMLElement | null => {
  for (let node = anchor; node && node !== document.body; node = node.parentElement) {
    if (!node.isConnected) continue;
    const candidate = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).find((el) => !(layer?.contains(el) ?? false) && el.closest("[inert]") === null);
    if (candidate) return candidate;
  }
  return document.querySelector<HTMLElement>("main h1");
};

const focusBack = (opener: Element | null, anchor: HTMLElement | null, layer: HTMLElement | null) => {
  if (opener instanceof HTMLElement && opener !== document.body && opener.isConnected && opener.closest("[inert]") === null) {
    opener.focus();
    return;
  }
  const target = fallbackFocus(anchor, layer);
  if (!target) return;
  // 見出しは焦点を受けられるようにしてから移す（押せる部品ではないので Tab の並びには入れない）
  if (/^H[1-3]$/.test(target.tagName) && !target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
  target.focus();
};

export const BottomSheet = ({ open, onClose, label, testId, keepMounted = false, foot, children }: Props) => {
  const layerRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const layer = layerRef.current;
    const opener = document.activeElement;
    // 戻し先が消えたときに探し始める場所（シートを置いた部品）。閉じたときにはシートが DOM に無いことがあるので、開いた時に控える
    const anchor = layer?.parentElement ?? null;
    const marked = layer ? inertOutside(layer) : [];
    // 中の部品が先に焦点を取っていれば（確かめの確定のボタンなど）、それを奪わない
    if (!sheetRef.current?.contains(document.activeElement)) sheetRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      for (const el of marked) el.removeAttribute("inert");
      focusBack(opener, anchor, layer);
    };
  }, [open]);

  if (!open && !keepMounted) return null;

  return (
    <div ref={layerRef} className={open ? "store-sheet-layer store-sheet-layer--open" : "store-sheet-layer"} inert={!open}>
      <div className="store-sheet__scrim" aria-hidden="true" onClick={onClose} />
      <div ref={sheetRef} className="store-sheet" role="dialog" aria-modal={open} aria-label={label} data-testid={testId} tabIndex={-1}>
        <div className="store-sheet__handle" aria-hidden="true" />
        <div className="store-sheet__scroll">{children}</div>
        {foot ? <div className="store-sheet__foot">{foot}</div> : null}
      </div>
    </div>
  );
};

export default BottomSheet;
