// Service Worker（設計書「ファイル構成の計画」）。
//
// 今あるのは **`/me` の殻と部品の保存**（タスク14）。通信の切れたスマホで `/me` を開き直しても
// 画面が立ち上がり、「端末に残した確保中の表示」が出る（要件9の基準 9.10〜9.12。残す内容そのものは
// `lib/client/reservationCache.ts` が localStorage に持つ）。
//
// 決め:
//   - 画面（navigate）は**まず通信**、だめなら保存した殻へ倒す（最新を見せるのを既定にし、切れた時だけ殻）。
//   - 部品（`/_next/static/**`）は**まず保存**（版ごとに URL が変わるので、古い版を掴んだままにならない）。
//   - 入口（`/api/**`）は保存しない。確保の状態は必ず通信で確かめ、確かめられなければ画面が
//     「確かめられていません」を出す（基準 9.11）。ここで古い応答を返すと、その見分けが壊れる。
//
// 位置は取らない（画面が開かれていない間はどこでも取らない・基準 3.9。構造の検査が見張る）。
// 公開してよい値も秘密も、このファイルには書かない（構造の検査が見張る。要る値は入口
// `GET /api/config/public` から画面が受け取る）。
//
// 中身は後のタスクが足す:
//   - タスク19: プッシュの受信と、通知を押したときに `/me` を開く（要件22）

const SHELL_CACHE = "ai-sekitori-shell-v1";
const ASSET_CACHE = "ai-sekitori-assets-v1";
/** 通信が切れていても立ち上がる必要がある画面（客の画面は1つの URL）。 */
const SHELL_PATH = "/me";

const saveShell = async () => {
  try {
    const cache = await caches.open(SHELL_CACHE);
    await cache.add(SHELL_PATH);
  } catch {
    // 保存できなくても入れ替えは進める（保存は表示の助けで、通信があれば無くても動く）
  }
};

self.addEventListener("install", (event) => {
  event.waitUntil(saveShell());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

/** まず通信。だめなら保存した殻（客の画面は1つなので、どの画面の要求でもこれで足りる）。 */
const shellFirstNetwork = async (request) => {
  try {
    const response = await fetch(request);
    const cache = await caches.open(SHELL_CACHE);
    await cache.put(SHELL_PATH, response.clone());
    return response;
  } catch (error) {
    const cached = await caches.match(SHELL_PATH);
    if (cached) return cached;
    throw error;
  }
};

/** まず保存。無ければ通信して保存する。 */
const assetFirstCache = async (request) => {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  const cache = await caches.open(ASSET_CACHE);
  await cache.put(request, response.clone());
  return response;
};

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // 入口は保存しない（古い応答を確保の今の状態として見せない）
  if (url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(shellFirstNetwork(request));
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
const FALLBACK_NOTICE = { title: "確保が取り消されました", body: "席の確保が取り消されました。アプリを開いて確かめてください。" };

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
