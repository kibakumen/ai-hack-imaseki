// 店のアカウントの画面（2026-09-22 追加）: ログインのメールアドレスの変更と、パスワードの変更への道。
// パスワードの変更そのものは `/store/password`（仮のパスワードで入った店と同じ画面）で行う。
import { EmailForm } from "../../../components/auth/EmailForm";
import { StoreNav } from "../../../components/store/StoreNav";

export default function StoreAccountPage() {
  return (
    <main className="store-main">
      <StoreNav active="account" />
      <h1>アカウント</h1>
      <EmailForm endpoint="/api/store/email" />
      <section>
        <h2>パスワード</h2>
        <p>
          <a href="/store/password">パスワードを変える</a>
        </p>
      </section>
    </main>
  );
}
