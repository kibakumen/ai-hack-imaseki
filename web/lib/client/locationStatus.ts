// 現在地まわりの小さな道具（2026-09-25 監査の指摘 安全-18・客-09）。
//
// **開いた瞬間には送り始めない**（安全-18 の案3）。以前は画面を開いた瞬間に現在地を取り、押す前に座標を
// 地図のサービス（Google）へ送って地名に直していた。今は、客が一度「現在地を使う」を押した端末だけ、
// 次から開いた瞬間に現在地を入れる（本人の指摘「開いた瞬間にここに現在地の文字に変換した場所が入っていて」を
// 守るため）。押したことはこの端末の localStorage にだけ覚え、サーバーへは送らない。
// 覚えられない端末（プライベートウィンドウ・保存を止めた端末）では、毎回押してもらう。

import type { ApiFailure } from "./api";

const CONSENT_KEY = "imaseki.location-consent";

/** この端末で、前に「現在地を使う」を押したか（押していれば開いた瞬間に現在地を入れる）。 */
export const hasLocationConsent = (): boolean => {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(CONSENT_KEY) === "1";
  } catch {
    return false;
  }
};

/** 「現在地を使う」を押したことを覚える。 */
export const rememberLocationConsent = (): void => {
  try {
    window.localStorage.setItem(CONSENT_KEY, "1");
  } catch {
    // 覚えられない端末では、次も押してもらう（開いた瞬間には送らない側へ倒す）
  }
};

/** 覚えを消す（この端末の登録を消したとき）。 */
export const forgetLocationConsent = (): void => {
  try {
    window.localStorage.removeItem(CONSENT_KEY);
  } catch {
    // 消せない端末では何もしない
  }
};

/** 現在地が取れなかった断りのうち、客が位置情報の許可を断ったもの（`client/geolocation` の印）。 */
export const isLocationDenied = (failure: ApiFailure): boolean => failure.error?.denied === true;
