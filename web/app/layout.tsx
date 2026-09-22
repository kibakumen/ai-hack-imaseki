import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "イマセキ",
  description: "近くのお店の空席を見つけるサービス",
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
      <body>{children}</body>
    </html>
  );
}
