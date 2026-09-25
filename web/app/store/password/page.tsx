// 【最終日】店のパスワードの変更（要件14の基準 14.14）。仮のパスワードで入った店を、
// ログインの直後とホームがここへ案内する。自分で決め直したいときにも同じ URL を開く。
// 今のパスワードの欄を出すかどうかは中身（StorePasswordPanel）がホームの印で決める（安全-07）。
import { StorePasswordPanel } from "../../../components/store/StorePasswordPanel";

export default function StorePasswordPage() {
  return (
    <main>
      <StorePasswordPanel />
    </main>
  );
}
