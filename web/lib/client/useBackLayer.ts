"use client";

// 端末の「戻る」で、画面の上に重ねたもの（演出・脇の画面・確保を持ったまま探している取得の画面）を閉じる
// （2026-09-25 監査の指摘 客-03）。客の画面は1つの URL（/me）なので、以前は戻る操作で /me の外へ出てしまい、
// 確保中の表示へ戻るつもりの客が画面ごと失っていた。
//
// 重ねたものを開くたびに、番号つきの履歴を1つ積む（`history.pushState`・URL は変えない）。戻る操作（popstate）で
// 戻った先の番号より後に積んだ重ねを閉じる。戻る以外（ボタン・状態の変化）で閉じたときは、積んだ履歴を1つ戻して
// 消す——そのとき起きる popstate は、戻った先より後に開いている重ねが無いので何も閉じない。
// ⚠️ 戻す数を数えて読み飛ばす形にしない。戻しの popstate が届かない場面（画面が消えた直後など）で数えが残ると、
//    次の本物の「戻る」を読み飛ばしてしまう。戻った先の番号だけで決める。

import { useEffect, useRef } from "react";

type Layer = { id: number; close: () => void };

/** 開いている重ね（開いた順）。画面をまたいで1つなので、モジュールに持つ */
let layers: Layer[] = [];
let lastId = 0;
let listening = false;

/** 履歴の状態に載せた番号（重ねの履歴でなければ 0） */
const layerIdOf = (state: unknown): number => {
  const id = (state as { imasekiLayer?: unknown } | null)?.imasekiLayer;
  return typeof id === "number" ? id : 0;
};

const onPopState = (event: PopStateEvent) => {
  const landed = layerIdOf(event.state);
  const closing = layers.filter((layer) => layer.id > landed);
  if (closing.length === 0) return;
  layers = layers.filter((layer) => layer.id <= landed);
  // 後から開いたものから閉じる
  [...closing].reverse().forEach((layer) => layer.close());
};

const listen = () => {
  if (listening) return;
  window.addEventListener("popstate", onPopState);
  listening = true;
};

/**
 * `open` が true の間、端末の「戻る」で `close` が呼ばれる。`close` は毎回いちばん新しいものを使う。
 * 同時に開く重ねが複数あれば、後から開いたものから順に閉じる。
 */
export const useBackLayer = (open: boolean, close: () => void): void => {
  const latestClose = useRef(close);
  useEffect(() => {
    latestClose.current = close;
  }, [close]);

  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    listen();
    lastId += 1;
    const layer: Layer = { id: lastId, close: () => latestClose.current() };
    layers = [...layers, layer];
    window.history.pushState({ imasekiLayer: layer.id }, "");
    return () => {
      // 戻る操作で閉じた重ねは、もう外れていて履歴も戻っている
      if (!layers.some((item) => item.id === layer.id)) return;
      layers = layers.filter((item) => item.id !== layer.id);
      // 積んだ履歴がいちばん上に在るときだけ戻して消す（ほかの重ねの履歴を消さない）
      if (layerIdOf(window.history.state) === layer.id) window.history.back();
    };
  }, [open]);
};
