import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteFooter } from "../components/ui/SiteFooter";
import "./globals.css";
import "./site-footer.css";

export const metadata: Metadata = {
  title: "イマセキ",
  description: "近くのお店の空席を見つけるサービス",
  // ホーム画面に追加したときのアプリとしての記述（2026-09-25 監査の指摘 客-04 の案C）。manifest は app/manifest.ts が出す。
  // `appleWebApp.capable` は新しい名前（mobile-web-app-capable）だけを出すので、古い iOS が読む名前も並べて出す。
  appleWebApp: { capable: true, title: "イマセキ", statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/apple-touch-icon.png" },
  other: { "apple-mobile-web-app-capable": "yes" },
};

type RootLayoutProps = Readonly<{ children: ReactNode }>;

// React が動く前に本人の明暗の選択を <html> へ立てる同期スクリプト（ちらつき防止）。
// `components/ui/ThemeToggle.tsx` が書く localStorage の同じ鍵を読むだけの小さな処理で、
// 判定ロジックはここと ThemeToggle の2箇所に置かない（「明るい/暗い以外なら端末に合わせる」の
// 1行だけをここに複製する）。プライベートウィンドウ等の例外は握って何もしない。
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("theme-choice");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="ja">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        {children}
        {/* 外への送信の一覧へ、どの画面からでも辿れるように（2026-09-25 監査の指摘 安全-18） */}
        <SiteFooter />
      </body>
    </html>
  );
}
