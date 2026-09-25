"use client";

// カードの登録の「戻ってきたら確かめる」の1手（2026-09-25 カード登録が画面から完了しない件（不具合-01）の案1）。
//
// 決済会社の画面は、入力を終えると戻り先 `/store/documents?card=returned` へ戻す。番号は戻り先に載らない
// ——確かめの入口（POST /api/store/card/confirm）が、サーバーの控えた番号を照会する。画面は本文なしで送るだけ。
// 戻る前にタブを閉じた店のために、ホームの `cardSetupPending`（始めたがまだ確かめていない）が立っていれば、
// 書類の画面とホームを開いたときにも1回送る。

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
