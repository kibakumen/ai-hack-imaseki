// 店の画面のタブ（2026-09-21 の本人の指摘「オファー・クーポン・店舗情報をタブで行き来したい」）。
// 速成版 `sprint/app/store/_components/StoreNav.tsx` の形をそのまま移した。
//
// 行き先は画面の話なのでここが持つ（入口は関わらない）。今どこに居るかは呼ぶ側が名前で渡す——
// 部品が `usePathname` を読むと、検査が部品を単体で描けなくなる（ルータの文脈が要る）ため。
//
// 右端にログアウトを置く（2026-09-25 監査の指摘 安全-09）。店の共用タブレットで、次に触った人へ
// 客の電話番号や確保の操作を残さないため。ボタン自体は店と運営で共用の部品（components/auth/LogoutButton）。

import { LogoutButton } from "../auth/LogoutButton";

export type StoreTabKey = "home" | "coupons" | "profile" | "documents" | "results" | "account";

const TABS: Array<{ key: StoreTabKey; label: string; href: string }> = [
  { key: "home", label: "オファー", href: "/store" },
  { key: "coupons", label: "クーポン", href: "/store/coupons" },
  { key: "profile", label: "店舗情報", href: "/store/profile" },
  { key: "documents", label: "書類", href: "/store/documents" },
  { key: "results", label: "実績", href: "/store/results" },
  // 2026-09-22 追加: ログインのメールアドレス・パスワードの変更。
  { key: "account", label: "アカウント", href: "/store/account" },
];

export const StoreNav = ({ active }: { active: StoreTabKey }) => (
  <nav className="store-tabs" aria-label="店の画面">
    {TABS.map((tab) => (
      <a key={tab.key} className="store-tab" href={tab.href} aria-current={tab.key === active ? "page" : undefined}>
        {tab.label}
      </a>
    ))}
    <LogoutButton className="store-tabs__logout" />
  </nav>
);

export default StoreNav;
