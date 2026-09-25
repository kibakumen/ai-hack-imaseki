// ホーム画面に追加するための記述（設計書「ファイル構成の計画」の app/manifest.ts・2026-09-25 監査の指摘 客-04 の案C）。
//
// 設計書は置くと決めていたが、無かった。無いと古い iOS ではホーム画面の追加がブックマーク扱いになり、
// 通知（要件22）を受け取れるホーム画面のアプリとして開かない。開く先は客の画面（/me）。
//
// ⚠️ ホーム画面のアプリは Safari と Cookie を共有しない。追加した側では登録をやり直すことになり、
//    Safari で取った今の確保はそちらに出ない——確保中の画面の案内（`components/customer/PushPrompt`）は、
//    今の確保は Safari で見て、次からホーム画面から開くよう伝える（客-04 の案A）。
//
// 色は画面の CSS の変数を使えない（ブラウザが画面を開く前に読む）ので、明るい配色の値を書き写す
// （app/globals.css の --color-background・--color-accent）。

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "イマセキ",
    short_name: "イマセキ",
    description: "近くのお店の空席を見つけるサービス",
    lang: "ja",
    start_url: "/me",
    scope: "/",
    display: "standalone",
    background_color: "#fffdfa",
    theme_color: "#ea580c",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
