// 店の登録（設計書「店の画面」の1歩目: /login →「はじめての方: 店を登録する」→ ここ）。
import type { Metadata } from "next";
import { RegisterForm } from "../../../components/store/RegisterForm";

export const metadata: Metadata = { title: "店の登録" };

// 見出しはログインの画面と同じ形（h1 を1つ・2026-09-25 監査の指摘 横断-12）。
export default function StoreRegisterPage() {
  return (
    <main>
      <header className="auth-head">
        <p className="auth-head__eyebrow">お店の方</p>
        <h1 className="auth-head__title">店の登録</h1>
      </header>
      <RegisterForm />
    </main>
  );
}
