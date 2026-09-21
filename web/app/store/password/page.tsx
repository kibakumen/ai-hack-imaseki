// 【最終日】店のパスワードの変更（要件14の基準 14.14）。仮のパスワードで入った店を、
// 店のホームがここへ案内する。自分で決め直したいときにも同じ URL を開く。
import { PasswordForm } from "../../../components/store/PasswordForm";

export default function StorePasswordPage() {
  return (
    <main>
      <PasswordForm />
    </main>
  );
}
