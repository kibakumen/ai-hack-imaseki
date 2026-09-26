// 運営のアカウントの画面（2026-09-22 追加）: 自分のログインのメールアドレスとパスワードを変える。
// 運営のアカウントは種データで作る（基準 14.8）ので、それまでは値を変えるのに seed-admin を
// 走らせ直すしか無かった。どちらも今のパスワードの再入力で本人を確かめる。
// 2026-09-26 本人選択（AI提示）: 店のホームの帯と同じ作りで、メールアドレスの確認の案内を先頭に置いた（まだ確認していないときだけ出る）。
import type { Metadata } from "next";
import { AdminEmailVerify } from "../../../components/admin/AdminEmailVerify";
import { EmailForm } from "../../../components/auth/EmailForm";
import { PasswordForm } from "../../../components/store/PasswordForm";

export const metadata: Metadata = { title: "アカウント（運営）" };

export default function AdminAccountPage() {
  return (
    <main>
      <h1>アカウント</h1>
      <AdminEmailVerify />
      <EmailForm endpoint="/api/admin/email" />
      <PasswordForm endpoint="/api/admin/password" requireCurrent />
    </main>
  );
}
