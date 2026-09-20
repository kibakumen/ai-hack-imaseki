import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "席アキ v2 — 近隣オファー・マッチング",
  description: "今この場所で入れる店を、嗜好とメニューから選んで返す",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="flex min-h-screen flex-col bg-white text-neutral-900 antialiased">{children}</body>
    </html>
  );
}
