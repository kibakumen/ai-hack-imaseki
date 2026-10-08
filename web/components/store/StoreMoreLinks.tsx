"use client";

// 店舗情報の画面の中の「承認の状態」と「そのほか」（2026-10-08 本人選択「案C 片手の親指」の論点1）。
// 下のナビを4つ（オファー・クーポン・実績・店舗情報）にまとめたので、ナビから外した書類・アカウント・ログアウトの道は
// ここに置く。ログアウトは店の共用の端末に客の情報を残さないための操作（2026-09-25 監査の指摘 安全-09）なので、
// 店舗情報を開けば必ず見える所に置く。
//
// 承認の状態も、承認済みの店のホームからはここへ移した（ホームの上は数字のカード1枚にする）。
// 状態は店のホームの入口から読むだけで、判断はしない（帯の文は StatusBanner が決まった文を当てる）。

import { useEffect, useState } from "react";
import { callApi, isFailure } from "../../lib/client/api";
import { LogoutButton } from "../auth/LogoutButton";
import { StatusBanner, type StoreStatusValue } from "./StatusBanner";

const LINKS: Array<{ href: string; label: string; note: string }> = [
  { href: "/store/documents", label: "書類", note: "営業許可書とカードの登録" },
  { href: "/store/account", label: "アカウント", note: "メールアドレス・パスワード・退会" },
];

export const StoreMoreLinks = () => {
  const [status, setStatus] = useState<StoreStatusValue | null>(null);

  useEffect(() => {
    let alive = true;
    void callApi("GET /api/store/home").then((home) => {
      if (alive && !isFailure(home)) setStatus(home.status);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      {status === null ? null : (
        <section className="store-card store-stack-sm" aria-labelledby="store-approval-heading">
          <h2 id="store-approval-heading">承認の状態</h2>
          <StatusBanner status={status} />
        </section>
      )}
      <section className="store-card store-stack-sm" aria-labelledby="store-more-heading">
        <h2 id="store-more-heading">そのほか</h2>
        <ul className="store-more">
          {LINKS.map((link) => (
            <li key={link.href}>
              <a className="store-more__row" href={link.href}>
                <span className="store-more__label">{link.label}</span>
                <span className="store-more__note">{link.note}</span>
              </a>
            </li>
          ))}
        </ul>
        <LogoutButton className="store-more__logout" />
      </section>
    </>
  );
};

export default StoreMoreLinks;
