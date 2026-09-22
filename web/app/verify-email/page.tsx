// 確認のリンクの着地（2026-09-22 追加・feat/email-verify）。URL の token を入口へ渡して結果を見せる。
// メールを送る口が無い公開先では入口が 404 を返し、この画面は断りの文を出す（リンクが配られることも無い）。
import { VerifyEmail } from "../../components/auth/VerifyEmail";

export default function VerifyEmailPage() {
  return <VerifyEmail />;
}
