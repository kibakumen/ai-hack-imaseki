// 【最終日】店のパスワードの変更（要件14の基準 14.14）。仮のパスワードで入った店を、
// ログインの直後とホームがここへ案内する。自分で決め直したいときにも同じ URL を開く。
// 今のパスワードの欄を出すかどうかは中身（StorePasswordPanel）がホームの印で決める（安全-07）。
import type { Metadata } from "next";
import { StorePasswordPanel } from "../../../components/store/StorePasswordPanel";

export const metadata: Metadata = { title: "パスワード" };

// 見出しとタブ（戻る道）は中身（StorePasswordPanel）が、ホームの印を見て出す——仮のパスワードの店は決めるまで
// ほかの画面を使えない（安全-21）のでタブを出さず、自分で変えに来た店にはアカウントのタブを出す（2026-09-25 監査の指摘 横断-12）。
export default function StorePasswordPage() {
  return (
    <main className="store-main">
      <StorePasswordPanel />
    </main>
  );
}
