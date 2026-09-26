// 確認のリンクの着地（2026-09-22 に枝 feat/email-verify で足し、2026-09-26 に取り込んだ）。URL の token を入口へ渡して結果を見せる。
// メールを送る口が無い公開先では入口が 404 を返し、この画面は断りの文を出す（リンクが配られることも無い）。
import type { Metadata } from "next";
import { VerifyEmail } from "../../components/auth/VerifyEmail";

export const metadata: Metadata = { title: "メールアドレスの確認" };

export default function VerifyEmailPage() {
  return (
    <main>
      <VerifyEmail />
    </main>
  );
}
