// どの画面の下にも置く1行（2026-09-25 監査の指摘 安全-18）。外への送信の一覧と個人情報の扱い（/privacy）へつなぐ。
// 殻（`app/layout.tsx`）が1回だけ描くので、入口・客の画面・ログイン・店の登録のどこからでも辿れる。

import Link from "next/link";

export const SiteFooter = () => (
  <footer className="site-footer">
    <Link href="/privacy">送信先と個人情報の扱い</Link>
  </footer>
);
