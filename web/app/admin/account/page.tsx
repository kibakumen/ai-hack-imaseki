// 運営のアカウントの画面（2026-09-22 追加）: 自分のログインのメールアドレスとパスワードを変える。
// 運営のアカウントは種データで作る（基準 14.8）ので、それまでは値を変えるのに seed-admin を
// 走らせ直すしか無かった。どちらも今のパスワードの再入力で本人を確かめる。
import { EmailForm } from "../../../components/auth/EmailForm";
import { PasswordForm } from "../../../components/store/PasswordForm";

export default function AdminAccountPage() {
  return (
    <main>
      <h1>アカウント</h1>
      <EmailForm endpoint="/api/admin/email" />
      <PasswordForm endpoint="/api/admin/password" requireCurrent />
    </main>
  );
}
