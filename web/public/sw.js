// Service Worker（設計書「ファイル構成の計画」）。
//
// 今在るのは2つ:
//   - 通知の受信と、通知を押したときに `/me` を開く（要件22・2026-09-21 タスク19 が足した）
//   - install / activate（すぐ効かせる）
// まだ足されていないもの:
//   - タスク14: `/me` の殻と部品の保存（機内モードで開き直しても確保中の表示が出る・基準 9.10〜9.12）
//
// **届くプッシュに中身は入っていない**（設計書「比べた案」のプッシュの行）。だから受け取ったら
// 入口 `GET /api/customer/push-message` に文面を取りに行き、場面ごとの決まった文を出す（基準 22.4）。
// 取りに行けなかったときは、下の共通の文を出す（通知を出さないと、許可を求めた約束を破ることになる）。
//
// 公開してよい値も秘密も、このファイルには書かない（構造の検査が見張る。要る値は入口
// `GET /api/config/public` から画面が受け取る）。

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

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  event.waitUntil(showNotice());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openApp());
});
