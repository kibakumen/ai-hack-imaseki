"use client";

// 運営の画面の殻のナビ（3つの画面とアカウント）。今どの画面にいるかを aria-current と見た目で示す
// （2026-09-25 監査の指摘 運営-11。それまで印が無く、同じ名前のナビが一覧の中にもう1列並んでいた）。
//
// 殻（app/admin/layout）は画面を移っても描き直されないので、今のパスは usePathname で読む。
// ルータの文脈が無いとき（部品だけを描く検査）は null になり、どれにも印を付けない。

import Link from "next/link";
import { usePathname } from "next/navigation";

const ADMIN_PAGES = [
  { href: "/admin", label: "店の一覧" },
  { href: "/admin/reports", label: "通報" },
  { href: "/admin/metrics", label: "数字" },
  // 2026-09-22 追加: 運営自身のメールアドレス・パスワードの変更。
  { href: "/admin/account", label: "アカウント" },
];

/** 店の詳細（/admin/stores/…）は「店の一覧」の中として扱う。 */
const isCurrent = (pathname: string | null, href: string): boolean => {
  if (pathname === null) return false;
  if (href === "/admin") return pathname === "/admin" || pathname.startsWith("/admin/stores");
  return pathname === href || pathname.startsWith(`${href}/`);
};

export const AdminNav = () => {
  const pathname = usePathname();
  return (
    <nav aria-label="運営の画面" data-testid="admin-nav">
      {ADMIN_PAGES.map((page) => (
        <Link key={page.href} href={page.href} aria-current={isCurrent(pathname, page.href) ? "page" : undefined}>
          {page.label}
        </Link>
      ))}
    </nav>
  );
};

export default AdminNav;
