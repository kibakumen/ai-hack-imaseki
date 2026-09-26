// Service Worker（設計書「ファイル構成の計画」）。
//
// 今あるのは **`/me` の殻と部品の保存**（タスク14）。通信の切れたスマホで `/me` を開き直しても
// 画面が立ち上がり、「端末に残した確保中の表示」が出る（要件9の基準 9.10〜9.12。残す内容そのものは
// `lib/client/reservationCache.ts` が localStorage に持つ）。
//
// 登録するのは客の画面（`components/customer/CustomerApp`）を開いたとき、**範囲は `/me`**（`lib/client/push` の
// `registerMeServiceWorker`）。通知の許可とは切り離してある（2026-09-25 監査の指摘 不具合-05——以前は通知を
// 許可した客にしか登録されず、「今はしない」・拒否・iPhone の Safari の客は電波の無い所で /me を開き直せなかった）。
//
// 決め:
//   - `/me` の画面の移動は**まず通信**、だめなら保存した殻へ倒す（最新を見せるのを既定にし、切れた時だけ殻）。
//     殻として保存するのは **`/me` の 2xx の応答だけ**。以前はどの画面の応答も状態を見ずに /me の殻として
//     上書きし、トップ・ログイン・500 の頁がオフラインの /me に出た。保存の失敗は取れた応答を捨てる理由にしない。
//   - 版を上げたら古い保存は入れ替わりのとき（activate）に消す。
//   - 部品（`/_next/static/**`）は**まず保存**（版ごとに URL が変わるので、古い版を掴んだままにならない）。
//     殻を残すときは、殻の HTML が指す部品も一緒に取って残す（初めて開いた回の部品は Service Worker の動く前に
//     読まれて残らないため・2026-09-26 のレビュー）。部品はブラウザの保存にも1年残す（public/_headers）。
//   - 入口（`/api/**`）は保存しない。確保の状態は必ず通信で確かめ、確かめられなければ画面が
//     「確かめられていません」を出す（基準 9.11）。ここで古い応答を返すと、その見分けが壊れる。
//
// 位置は取らない（画面が開かれていない間はどこでも取らない・基準 3.9。構造の検査が見張る）。
// 公開してよい値も秘密も、このファイルには書かない（構造の検査が見張る。要る値は入口
// `GET /api/config/public` から画面が受け取る）。
//
// 中身は後のタスクが足す:
//   - タスク19: プッシュの受信と、通知を押したときに `/me` を開く（要件22）

const SHELL_CACHE = "ai-sekitori-shell-v2";
const ASSET_CACHE = "ai-sekitori-assets-v2";
/** 今の版が使う保存の名前。これ以外は入れ替わりのときに消す */
const CURRENT_CACHES = [SHELL_CACHE, ASSET_CACHE];
/** 通信が切れていても立ち上がる必要がある画面（客の画面は1つの URL）。 */
const SHELL_PATH = "/me";

/**
 * 殻の HTML が指す部品（`/_next/static` の下）の URL。script・link の属性と、実行時の流し込み（RSC の文字列の中の
 * `\"/_next/static/…\"`）の両方から拾う（2026-09-26 のレビュー・不具合-05 の残り）。よそのオリジンは拾わない。
 */
const STATIC_ASSET = /\/_next\/static\/[A-Za-z0-9_\-.~%/]+/g;
const assetUrlsOf = (html) => [...new Set(html.match(STATIC_ASSET) ?? [])];

/** 部品を1つずつ取って保存する。2xx だけを残し、1つ取れなくてもほかは残す。保存済みのものは取り直さない。 */
const keepAssets = async (urls) => {
  let cache;
  try {
    cache = await caches.open(ASSET_CACHE);
  } catch {
    return;
  }
  await Promise.all(
    urls.map(async (url) => {
      try {
        if (await cache.match(url)) return;
        const response = await fetch(url);
        if (response.ok) await cache.put(url, response);
      } catch {
        // 取れなかった部品は、次に殻を取ったときにまた試す
      }
    }),
  );
};

/**
 * 取れた /me の応答（2xx だけ）を殻として残し、殻が指す部品も残す。失敗しても応答は捨てない（保存は表示の助けで、
 * 無くても通信で動く）。部品も一緒に残すのは、初めて /me を開いた回の部品が Service Worker の動く前に読まれて
 * 残らず、そのまま電波の無い所で開き直すと殻は出ても JS が読めなかったため（2026-09-26 のレビュー・不具合-05 の残り）。
 */
const keepShell = async (response) => {
  if (!response.ok) return;
  let html;
  try {
    const cache = await caches.open(SHELL_CACHE);
    await cache.put(SHELL_PATH, response.clone());
    html = await response.text();
  } catch {
    // 端末の容量が足りない・保存を止めている。次に取れたときにまた残す
    return;
  }
  await keepAssets(assetUrlsOf(html));
};

/** 入れ替わり（install）のときに、殻と殻が指す部品を取って残す。 */
const saveShell = async () => {
  try {
    await keepShell(await fetch(SHELL_PATH));
  } catch {
    // 保存できなくても入れ替えは進める（保存は表示の助けで、通信があれば無くても動く）
  }
};

self.addEventListener("install", (event) => {
  event.waitUntil(saveShell());
  self.skipWaiting();
});

/** 古い版の保存を消す（保存の名前に版を入れてある）。 */
const dropOldCaches = async () => {
  const names = await caches.keys();
  await Promise.all(names.filter((name) => !CURRENT_CACHES.includes(name)).map((name) => caches.delete(name)));
};

self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all([dropOldCaches(), self.clients.claim()]));
});

/**
 * /me の画面の移動: まず通信。通信が切れていたら保存した殻。
 * 殻と部品の保存は応答を返したあとに続ける（waitUntil）——部品を取り終えるまで画面の表示を待たせない。
 */
const shellFirstNetwork = async (event) => {
  let response;
  try {
    response = await fetch(event.request);
  } catch (error) {
    const cached = await caches.match(SHELL_PATH);
    if (cached) return cached;
    throw error;
  }
  if (response.ok) event.waitUntil(keepShell(response.clone()));
  return response;
};

/** まず保存。無ければ通信して、取れた（2xx）ものだけ保存する。保存の失敗で応答を捨てない。 */
const assetFirstCache = async (request) => {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (!response.ok) return response;
  try {
    const cache = await caches.open(ASSET_CACHE);
    await cache.put(request, response.clone());
  } catch {
    // 保存できなくても部品は届いている
  }
  return response;
};

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // 入口は保存しない（古い応答を確保の今の状態として見せない）
  if (url.pathname.startsWith("/api/")) return;
  // 殻を返すのは /me の画面の移動だけ（ほかの画面を /me の殻として保存しない・不具合-05）
  if (request.mode === "navigate") {
    if (url.pathname === SHELL_PATH) event.respondWith(shellFirstNetwork(event));
    return;
  }
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(assetFirstCache(request));
  }
});

// ---------- 通知の受信（タスク19・要件22） ----------

/** 文面を取りに行く入口（客の Cookie で見分ける＝同じサイトへの読み取りなので Cookie が付く） */
const MESSAGE_URL = "/api/customer/push-message";
/** 通知を押したときに開く画面（優先の順の4で取り消しの表示が出る・基準 22.12） */
const APP_URL = "/me";
/** 文面が取れなかったときの共通の文（送るのは取り消しの2つの場面だけなので、これで足りる） */
const FALLBACK_NOTICE = { title: "確保がキャンセルされました", body: "席の確保がキャンセルされました。アプリを開いて確かめてください。" };

const readNotice = async () => {
  try {
    const res = await fetch(MESSAGE_URL, { credentials: "same-origin", cache: "no-store" });
    if (!res.ok) return FALLBACK_NOTICE;
    const message = await res.json();
    if (!message || typeof message.title !== "string" || typeof message.body !== "string") return FALLBACK_NOTICE;
    return { title: message.title, body: message.body };
  } catch {
    // 通信に失敗した（電波が無い・入口が答えない）。共通の文で知らせる。
    return FALLBACK_NOTICE;
  }
};

const showNotice = async () => {
  const notice = await readNotice();
  await self.registration.showNotification(notice.title, {
    body: notice.body,
    // 同じ話の通知を重ねない（取り消しは1件の確保に1回）。
    tag: "reservation-cancelled",
    data: { url: APP_URL },
  });
};

const openApp = async () => {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const opened = windows.find((client) => typeof client.url === "string" && client.url.endsWith(APP_URL));
  if (opened) {
    await opened.focus();
    return;
  }
  await self.clients.openWindow(APP_URL);
};

self.addEventListener("push", (event) => {
  event.waitUntil(showNotice());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openApp());
});

// ---------- 購読の作り直し（2026-09-25 監査の指摘 不具合-11） ----------
//
// 配信元が購読を入れ替えた・切れたときに届く。受け手が無いと、サーバーの購読は古いまま「もう無い」と
// 返されて消され、取り消しの通知（要件22）が気づかないうちに届かなくなる。新しい購読を入口へ預け直す。
// 鍵は入口 `GET /api/config/public` から受け取る（このファイルに値を書かない・構造の検査が見張る）。
// 預けられなくても、客が /me を開けば画面の側（`lib/client/push` の `restorePushSubscription`）が作り直す。

const SUBSCRIPTION_URL = "/api/customer/push-subscription";
const CONFIG_URL = "/api/config/public";

/** base64url の公開鍵を、`subscribe` が受け取るバイト列に直す（`lib/client/push` と同じ変換）。 */
const toKeyBytes = (base64Url) => {
  const normalized = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
};

/** 新しい購読を作るときの設定。古い購読の設定が残っていればそれを、無ければ公開値の鍵で組む。 */
const subscribeOptions = async (oldSubscription) => {
  if (oldSubscription && oldSubscription.options && oldSubscription.options.applicationServerKey) return oldSubscription.options;
  const res = await fetch(CONFIG_URL, { credentials: "same-origin", cache: "no-store" });
  if (!res.ok) return null;
  const config = await res.json();
  const key = config && typeof config.vapidPublicKey === "string" ? config.vapidPublicKey : "";
  return key === "" ? null : { userVisibleOnly: true, applicationServerKey: toKeyBytes(key) };
};

const resubscribe = async (event) => {
  try {
    let subscription = event.newSubscription;
    if (!subscription) {
      const options = await subscribeOptions(event.oldSubscription);
      if (!options) return;
      subscription = await self.registration.pushManager.subscribe(options);
    }
    await fetch(SUBSCRIPTION_URL, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });
  } catch {
    // 端末が購読を断った・通信が切れている。次に /me を開いたときに画面の側が作り直す
  }
};

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(resubscribe(event));
});
