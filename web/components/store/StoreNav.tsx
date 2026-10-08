// 店の画面の下のナビ（2026-10-08 本人選択「案C 片手の親指」の論点1）。
// それまでは上のタブ6つ（オファー・クーポン・店舗情報・書類・実績・アカウント）とログアウトを1段の横スクロールに並べていた。
// 今は**画面の下に4つ**（オファー・クーポン・実績・店舗情報）だけを置き、親指の届く所で行き来する。
// 書類・アカウント・ログアウトは店舗情報の画面の中から辿る（StoreMoreLinks）。書類とアカウントを開いている間は
// 「店舗情報」を今の場所として光らせる（どこから来たかを見失わない）。
//
// 行き先は画面の話なのでここが持つ（入口は関わらない）。今どこに居るかは呼ぶ側が名前で渡す——
// 部品が `usePathname` を読むと、検査が部品を単体で描けなくなる（ルータの文脈が要る）ため。
//
// ⚠️ DOM の並びでは見出しの前に置く（読み上げとキーボードで、どの画面でも同じ所にある・横断-12）。目には CSS が下へ固定する。

import { TERMS } from "../../lib/domain/texts";

export type StoreTabKey = "home" | "coupons" | "profile" | "documents" | "results" | "account";

type NavKey = "home" | "coupons" | "results" | "profile";

const ICONS: Record<NavKey, string> = {
  // 稲妻（いま出しているオファー）
  home: "M13 2 4 14h7l-1 8 9-12h-7l1-8z",
  // 札（クーポン）
  coupons: "M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V7zm11-2v14",
  // 棒グラフ（実績）
  results: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  // 店（店舗情報）
  profile: "M3 9 5 4h14l2 5M3 9h18M3 9v1a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0V9M5 13v7h14v-7M10 20v-4h4v4",
};

const TABS: Array<{ key: NavKey; label: string; href: string }> = [
  { key: "home", label: "オファー", href: "/store" },
  { key: "coupons", label: "クーポン", href: "/store/coupons" },
  { key: "results", label: "実績", href: "/store/results" },
  { key: "profile", label: TERMS.storeProfile, href: "/store/profile" },
];

/** 書類とアカウントは店舗情報の中の画面なので、店舗情報を光らせる */
const navKeyOf = (active: StoreTabKey): NavKey => (active === "documents" || active === "account" ? "profile" : active);

type Props = {
  active: StoreTabKey;
  /** 店舗情報に付ける、まだ済んでいないものの数（承認待ちの店のホームだけが渡す） */
  profileAlert?: number;
};

export const StoreNav = ({ active, profileAlert = 0 }: Props) => {
  const current = navKeyOf(active);
  return (
    <nav className="store-tabs" aria-label="店の画面">
      {TABS.map((tab) => (
        <a key={tab.key} className="store-tab" href={tab.href} aria-current={tab.key === current ? "page" : undefined}>
          <span className="store-tab__ind" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="22" height="22" focusable="false">
              <path d={ICONS[tab.key]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {tab.key === "profile" && profileAlert > 0 ? <span className="store-tab__dot">{profileAlert}</span> : null}
          </span>
          <span className="store-tab__label">
            {tab.label}
            {tab.key === "profile" && profileAlert > 0 ? <span className="store-sr-only">（まだ済んでいないもの {profileAlert} つ）</span> : null}
          </span>
        </a>
      ))}
    </nav>
  );
};

export default StoreNav;
