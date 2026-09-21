// 店と運営のログイン（1つの URL。通ったあと役割で行き先を分ける・設計書「店の画面」）。
import Link from "next/link";
import { LoginForm } from "../../components/auth/LoginForm";

export default function LoginPage() {
  return (
    <main>
      <LoginForm />
      <p>
        はじめての方: <Link href="/store/register">店を登録する</Link>
      </p>
    </main>
  );
}
