"use client";

// カードの登録の「戻ってきたら確かめる」の1手（2026-09-25 カード登録が画面から完了しない件（不具合-01）の案1）。
//
// 決済会社の画面は、入力を終えると戻り先 `/store/documents?card=returned` へ戻す。番号は戻り先に載らない
// ——確かめの入口（POST /api/store/card/confirm）が、サーバーの控えた番号を照会する。画面は本文なしで送るだけ。
// 戻る前にタブを閉じた店のために、ホームの `cardSetupPending`（始めたがまだ確かめていない）が立っていれば、
// 書類の画面かホームを開いたときにも送る——ただし**戻ってきた印の無い自動の確かめは、1つのブラウザのセッションで
// 1回だけ**（2026-09-25 カード登録の自動の確かめのレビュー）。確かめは開始と同じ回数の制限で数えるので、開くたびに
// 送ると、入力を終えなかった店が制限を使い切り、本当に押した「カードを登録する」まで断られた。
// 「カードを登録する」を押してやり直したら、また1回送れる（`resetAutoConfirmTurn`）。

import { callApi, isFailure, type ApiFailure } from "../../lib/client/api";

const RETURN_PARAM = "card";
const RETURN_VALUE = "returned";

/** 今の URL が、決済会社の画面から戻ってきた印を持つか。 */
export const cameBackFromCardSetup = (): boolean => {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get(RETURN_PARAM) === RETURN_VALUE;
};

/** 戻ってきた印を URL から外す（読み込み直し・ブックマークで確かめを送り直さない）。履歴は増やさない。 */
export const clearCardReturnMark = (): void => {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(RETURN_PARAM)) return;
  url.searchParams.delete(RETURN_PARAM);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
};

/** 確かめを1回送る。通れば null、断られたら断り（呼ぶ側が文を出すかを決める）。 */
export const confirmCardSetup = async (): Promise<ApiFailure | null> => {
  const result = await callApi("POST /api/store/card/confirm", { body: {} });
  return isFailure(result) ? result : null;
};

/** 自動の確かめを使った印（sessionStorage＝1つのブラウザのセッションの間だけ残る） */
const AUTO_CONFIRM_KEY = "imaseki.cardAutoConfirmed";
/** sessionStorage が使えない（プライベートの窓・保存を止めた設定）ときの控え。読み込み直しで消える */
let autoConfirmedWithoutStorage = false;

const autoConfirmUsed = (): boolean => {
  try {
    return window.sessionStorage.getItem(AUTO_CONFIRM_KEY) === "1";
  } catch {
    return autoConfirmedWithoutStorage;
  }
};

const markAutoConfirm = (used: boolean): void => {
  autoConfirmedWithoutStorage = used;
  try {
    if (used) window.sessionStorage.setItem(AUTO_CONFIRM_KEY, "1");
    else window.sessionStorage.removeItem(AUTO_CONFIRM_KEY);
  } catch {
    // 控え（autoConfirmedWithoutStorage）だけで数える
  }
};

/**
 * 戻ってきた印の無い、自動の確かめを送ってよいか。送ってよければ true を返し、同時に使った印を付ける
 * （ホームと書類の画面が同じ1回を分け合う）。
 */
export const takeAutoConfirmTurn = (): boolean => {
  if (typeof window === "undefined" || autoConfirmUsed()) return false;
  markAutoConfirm(true);
  return true;
};

/** 登録をやり直した（「カードを登録する」を押した）。次に開いたとき、また1回だけ自動の確かめを送れる。 */
export const resetAutoConfirmTurn = (): void => {
  if (typeof window === "undefined") return;
  markAutoConfirm(false);
};
