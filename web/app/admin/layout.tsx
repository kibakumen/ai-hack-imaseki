// 運営の画面の殻（設計書「運営の画面」）。3つの画面——ホーム（店の一覧）・通報・数字——は
// 設計書に在るのに、どの画面からも互いへ移る導線が無く、URL を直に打つしか開けなかった
// （2026-09-22 タスク25 の横断の揃えで足した）。
//
// 導線だけを置く殻で、中身は各画面の部品が持つ。運営の画面は PC 向けなので常に3つとも出す。
import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeToggle } from "../../components/ui/ThemeToggle";

const ADMIN_PAGES = [
  { href: "/admin", label: "店の一覧" },
  { href: "/admin/reports", label: "通報" },
  { href: "/admin/metrics", label: "数字" },
  // 2026-09-22 追加: 運営自身のメールアドレス・パスワードの変更。
  { href: "/admin/account", label: "アカウント" },
];

type AdminLayoutProps = Readonly<{ children: ReactNode }>;

export default function AdminLayout({ children }: AdminLayoutProps) {
  return (
    <>
      <nav aria-label="運営の画面" data-testid="admin-nav">
        {ADMIN_PAGES.map((page) => (
          <Link key={page.href} href={page.href}>
            {page.label}
          </Link>
        ))}
      </nav>
      {children}
      {/* `position: fixed` で描く（`app/globals.css` の `.theme-toggle` が admin-nav の
          高さぶん下げる）。children の DOM 構造は変えない。 */}
      <ThemeToggle />
    </>
  );
}
