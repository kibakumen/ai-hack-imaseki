// 店と運営のログイン（1つの URL。通ったあと役割で行き先を分ける・設計書「店の画面」）。
// 2026-09-22 に見た目を直した: 入力欄が枠線だけで浮いていたので、どの面に何を打つのかが
// 分かるように見出しと案内を付けた（形だけ・色は `app/globals.css` の変数）。
import Link from "next/link";
import { LoginForm } from "../../components/auth/LoginForm";

export default function LoginPage() {
  return (
    <main>
      <header className="auth-head">
        <p className="auth-head__eyebrow">お店・運営の方</p>
        <h1 className="auth-head__title">イマセキ</h1>
      </header>
      <LoginForm />
      <p className="auth-foot">
        はじめての方: <Link href="/store/register">店を登録する</Link>
      </p>
    </main>
  );
}
