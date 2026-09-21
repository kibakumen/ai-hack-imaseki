// 店の情報の画面（設計書「店の画面」の下のナビの「店の情報」）。
// ⚠️ 2026-09-22 に足した——店のホームと、公開を断られたときの案内（`profile_incomplete`）が
//    どちらも `/store/profile` を指しているのに、この道が無かった（開いても何も出なかった）。
import { StoreNav } from "../../../components/store/StoreNav";
import { ProfileForm } from "../../../components/store/ProfileForm";

export default function StoreProfilePage() {
  return (
    <main className="store-main">
      <StoreNav active="profile" />
      <ProfileForm />
    </main>
  );
}
