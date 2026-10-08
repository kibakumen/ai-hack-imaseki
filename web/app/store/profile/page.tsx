// 店舗情報の画面（設計書「店の画面」の下のナビの「店の情報」）。
// ⚠️ 2026-09-22 に足した——店のホームと、公開を断られたときの案内（`profile_incomplete`）が
//    どちらも `/store/profile` を指しているのに、この道が無かった（開いても何も出なかった）。
import type { Metadata } from "next";
import { StoreNav } from "../../../components/store/StoreNav";
import { ProfileForm } from "../../../components/store/ProfileForm";
import { StoreMoreLinks } from "../../../components/store/StoreMoreLinks";
import { TERMS } from "../../../lib/domain/texts";

export const metadata: Metadata = { title: TERMS.storeProfile };

// 見出しはタブと同じ「店舗情報」（それまでは見出しが「お店の情報」、案内が「店の情報」と3通りあった・横断-11）。
// 読み込みに失敗しても見出しとタブは出す（h1 は読み込みの部品の外・横断-12）。
export default function StoreProfilePage() {
  return (
    <main className="store-main">
      <StoreNav active="profile" />
      <div className="store-head">
        <h1>{TERMS.storeProfile}</h1>
      </div>
      {/* 承認の状態と、下のナビから外した書類・アカウント・ログアウトの道（2026-10-08 本人選択「案C 片手の親指」） */}
      <StoreMoreLinks />
      <ProfileForm />
    </main>
  );
}
