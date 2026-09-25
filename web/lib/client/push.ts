// Service Worker の登録と、通知の購読を作るただ1つの場所（要件9の基準 9.12・要件22の基準 22.8〜22.11）。
// 部品 `components/customer/PushPrompt` と、客の画面の入れ物（`CustomerApp` の `useMeServiceWorker`）がここを呼ぶ。
// 入口へ送るのは `client/api` 経由で、このファイルは通信の呼び出しを持たない（基準 29.4）。
//
// **VAPID の公開鍵はここに書かない**——入口 `GET /api/config/public`（`client/api` の
// `getPublicConfig()`）から受け取る（設計書「公開してよい2つの値の置き場所と、画面までの経路」）。
// 取れなかったときは購読を作らず、断りの文も出さない（通知は無くても、画面を開けば取り消しは分かる）。
//
// 2026-09-25 監査の指摘で直した3つ:
//   - 不具合-05: Service Worker の登録を通知の許可から切り離し、/me を開いたときに `/me` の範囲で登録する
//     （`registerMeServiceWorker`）。以前は許可した客にしか登録されず、電波の無い所で /me を開き直せなかった。
//   - 不具合-11: 許可済みなのに購読が無い（切れた・サーバーが消した）ときは、開いたときに黙って作り直す
//     （`restorePushSubscription`）。端末の「答えた」の印は**「今はしない」を押したときだけ**付け、
//     許可した端末の作り直しは印に関わらず行う。
//   - 客-04: 許可を求める問いは押した直後に出す（公開値の読み込みを待ってから問うと、iPhone の Safari では
//     押した操作との結びつきが切れて問いが出ないことがある）。

import { callApi, getPublicConfig, isFailure } from "./api";

/** 「今はしない」を押したことを端末に覚えておく鍵（基準 22.11。答えは端末ごとで、サーバーには置かない） */
const ANSWERED_KEY = "ai-hack:push-answered";
/** 印の値。以前の版は許可・拒否どちらでも "1" を書いていたので、読むときは値を問わず「答えた」とみなす */
const DECLINED = "declined";

/** Service Worker を置く範囲（客の画面は1つの URL・`public/sw.js` の注） */
export const SW_SCOPE = "/me";
const SW_URL = "/sw.js";

/** 購読を作る前に、Service Worker が動き出すのを待つ長さの上限（登録できない端末で待ち続けない） */
const READY_TIMEOUT_MS = 10_000;

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

/** 「今はしない」（通知の仕組みが無い端末では「閉じる」）を押したことを覚える（基準 22.11）。 */
export const rememberPushDecline = (): void => {
  try {
    window.localStorage.setItem(ANSWERED_KEY, DECLINED);
  } catch {
    // 端末が localStorage を断る設定（iPhone のプライベートなど）。覚えられないだけで先へ進める。
  }
};

/** 端末がもう許可・拒否を答えているか（答えていれば説明を出す意味が無い）。 */
export const permissionSettled = (): boolean => pushSupported() && Notification.permission !== "default";

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
 * 客の画面を開いたときに、Service Worker を `/me` の範囲で登録する（不具合-05）。通知の許可には依らない。
 * 以前の版が `/`（既定の範囲）で登録したものは外す——どの画面の応答も /me の殻として保存していたので。
 * 登録できない端末・ブラウザでは何もしない（殻が無くても、通信があれば画面は動く）。
 */
export const registerMeServiceWorker = async (): Promise<void> => {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE });
    const current = registration?.scope;
    if (current === undefined) return;
    const all = (await navigator.serviceWorker.getRegistrations?.()) ?? [];
    await Promise.all(all.filter((other) => other.scope !== current).map((other) => other.unregister()));
  } catch {
    // 登録を断られた（プライベートの窓・設定で止めている）。殻が無いだけで先へ進める。
  }
};

/** 動いている Service Worker の登録を待つ。上限を過ぎたら null（登録できていない端末で待ち続けない）。 */
const readyRegistration = async (): Promise<ServiceWorkerRegistration | null> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), READY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

/** 端末の購読（無ければ作る）を入口へ預ける。鍵が取れない・端末が断ったら false。 */
const saveSubscription = async (registration: ServiceWorkerRegistration, existing: PushSubscription | null): Promise<boolean> => {
  let subscription = existing;
  if (subscription === null) {
    const config = await getPublicConfig();
    const key = config?.vapidPublicKey ?? "";
    if (key === "") return false;
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(key) });
  }
  const result = await callApi("POST /api/customer/push-subscription", { body: { subscription: subscription.toJSON() } });
  return !isFailure(result);
};

/**
 * 通知を許可してもらい、購読を作って入口へ預ける。できなければ false を返すだけで、
 * 画面には断りを出さない（基準 22.9 の「開けば分かる」が担保）。
 *
 * 途中で止まる所（どれも false）: 仕組みが無い／許可されない／公開鍵が取れない／端末が購読を断る。
 */
export const subscribeToPush = async (): Promise<boolean> => {
  if (!pushSupported()) return false;
  // 押した直後に問う（客-04）。公開値の読み込みはそのあと
  if (!(await askPermission())) return false;
  try {
    await registerMeServiceWorker();
    const registration = await readyRegistration();
    if (registration === null) return false;
    // 同じ端末で2度目に押されたときに、購読を作り直さない（配信元の URL が変わってしまう）。
    return await saveSubscription(registration, await registration.pushManager.getSubscription());
  } catch {
    // 端末が購読を断った・Service Worker を登録できない。通知なしで先へ進める。
    return false;
  }
};

/** 作り直しを1つずつ順に行う（開いた時と、サーバーが「無い」と言った時が重なっても2つ同時に作らない） */
let restoring: Promise<boolean> = Promise.resolve(false);

/**
 * 許可済みの端末で、購読が切れていたら黙って作り直して入口へ預ける（不具合-11）。問いは出さない。
 * `serverMissing` はサーバーが「この客の購読が無い」と言ったか（ホームの `pushPromptDue`）——そのときは
 * 端末に購読が残っていても預け直す（配信元が「もう無い」と返してサーバーが消した・同じ端末で別の客になった）。
 */
export const restorePushSubscription = (serverMissing: boolean): Promise<boolean> => {
  const run = async (): Promise<boolean> => {
    if (!pushSupported() || Notification.permission !== "granted") return false;
    try {
      const registration = await readyRegistration();
      if (registration === null) return false;
      const existing = await registration.pushManager.getSubscription();
      if (existing !== null && !serverMissing) return true;
      return await saveSubscription(registration, existing);
    } catch {
      return false;
    }
  };
  restoring = restoring.then(run, run);
  return restoring;
};
