// 通知の購読を作るただ1つの場所（要件22の基準 22.8〜22.11）。部品 `components/customer/PushPrompt`
// がここを呼ぶ。入口へ送るのは `client/api` 経由で、このファイルは通信の呼び出しを持たない（基準 29.4）。
//
// **VAPID の公開鍵はここに書かない**——入口 `GET /api/config/public`（`client/api` の
// `getPublicConfig()`）から受け取る（設計書「公開してよい2つの値の置き場所と、画面までの経路」）。
// 取れなかったときは購読を作らず、断りの文も出さない（通知は無くても、画面を開けば取り消しは分かる）。

import { apiCall, getPublicConfig, isFailure } from "./api";

/** 許可か拒否を答えたことを端末に覚えておく鍵（基準 22.11。答えは端末ごとで、サーバーには置かない） */
const ANSWERED_KEY = "ai-hack:push-answered";

/** この端末のこのブラウザに通知が届く仕組みが在るか（無い端末には許可を求めない・基準 22.10）。 */
export const pushSupported = (): boolean =>
  typeof window !== "undefined" && typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof globalThis.PushManager !== "undefined" && typeof globalThis.Notification !== "undefined";

/** 端末に残した「もう答えた」の印を読む（localStorage が使えない端末では毎回 false）。 */
export const pushAnswered = (): boolean => {
  try {
    return window.localStorage.getItem(ANSWERED_KEY) !== null;
  } catch {
    return false;
  }
};

/** 「通知を受け取る」「今はしない」のどちらを押しても、答えたことを覚える（基準 22.11）。 */
export const rememberPushAnswer = (): void => {
  try {
    window.localStorage.setItem(ANSWERED_KEY, "1");
  } catch {
    // 端末が localStorage を断る設定（iPhone のプライベートなど）。覚えられないだけで先へ進める。
  }
};

/** base64url の公開鍵を、`subscribe` が受け取るバイト列に直す。 */
const applicationServerKey = (base64Url: string): Uint8Array => {
  const normalized = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(window.atob(padded), (char) => char.charCodeAt(0));
};

const askPermission = async (): Promise<boolean> => {
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
};

/**
 * 通知を許可してもらい、購読を作って入口へ預ける。できなければ false を返すだけで、
 * 画面には断りを出さない（基準 22.9 の「開けば分かる」が担保）。
 *
 * 途中で止まる所（どれも false）: 仕組みが無い／公開鍵が取れない／許可されない／端末が購読を断る。
 */
export const subscribeToPush = async (): Promise<boolean> => {
  if (!pushSupported()) return false;
  const config = await getPublicConfig();
  const key = config?.vapidPublicKey ?? "";
  if (key === "") return false;
  if (!(await askPermission())) return false;
  try {
    await navigator.serviceWorker.register("/sw.js");
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    // 同じ端末で2度目に押されたときに、購読を作り直さない（配信元の URL が変わってしまう）。
    const subscription = existing ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(key) }));
    const result = await apiCall("POST", "/api/customer/push-subscription", { subscription: subscription.toJSON() });
    return !isFailure(result);
  } catch {
    // 端末が購読を断った・Service Worker を登録できない。通知なしで先へ進める。
    return false;
  }
};
