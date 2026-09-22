// 店のアカウントの画面（2026-09-22 追加）: ログインのメールアドレスの変更と、パスワードの変更への道。
// パスワードの変更そのものは `/store/password`（仮のパスワードで入った店と同じ画面）で行う。
import { EmailForm } from "../../../components/auth/EmailForm";
import { StoreNav } from "../../../components/store/StoreNav";

export default function StoreAccountPage() {
  return (
    <main className="store-main">
      <StoreNav active="account" />
      <div className="store-head">
        <div>
          <p className="store-eyebrow">店の画面</p>
          <h1>アカウント</h1>
        </div>
      </div>
      <EmailForm endpoint="/api/store/email" />
      <section className="store-card store-stack-sm">
        <h2>パスワード</h2>
        <p className="store-note">仮のパスワードで入った店も、自分で決め直したい店も、同じ画面で変えられます。</p>
        <p>
          <a className="store-btn store-btn--quiet store-btn--link" href="/store/password">
            パスワードを変える
          </a>
        </p>
      </section>
    </main>
  );
}
