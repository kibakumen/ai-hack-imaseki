"use client";

// 店舗情報の画面の中の「承認の状態」と「そのほか」（2026-10-08 本人選択「案C 片手の親指」の論点1）。
// 下のナビを4つ（オファー・クーポン・実績・店舗情報）にまとめたので、ナビから外した書類・アカウント・ログアウトの道は
// ここに置く。ログアウトは店の共用の端末に客の情報を残さないための操作（2026-09-25 監査の指摘 安全-09）なので、
// 店舗情報を開けば必ず見える所に置く。
//
// 承認の状態も、承認済みの店のホームからはここへ移した（ホームの上は数字のカード1枚にする）。
// 状態は軽い入口 `GET /api/store/status`（状態の1語だけ）から読む（2026-10-08 本人選択・AI提示）。それまでは店のホーム
// （向かっている客の呼び名・電話番号まで入る）を丸ごと読んでいた。判断はしない（帯の文は StatusBanner が決まった文を当てる）。
// 読めなかったときは、黙って何も出さずに終えない——読めなかったことと「もう一度読み込む」を出す。

import { callApi, type ApiFailure } from "../../lib/client/api";
import { useLoad } from "../../lib/client/useLoad";
import { LOAD_TEXTS } from "../../lib/domain/texts";
import { LogoutButton } from "../auth/LogoutButton";
import { LoadMessage } from "../ui/InputRefusal";
import { StatusBanner, type StoreStatusValue } from "./StatusBanner";

const loadStatus = (): Promise<{ ok: true; status: StoreStatusValue } | ApiFailure> => callApi("GET /api/store/status");

/** 承認の状態の中身（読み込み中・読めなかった・読めた） */
const ApprovalState = () => {
  const { state, reload } = useLoad(loadStatus);
  if (state.status === "loading") {
    return (
      <p className="store-note" aria-busy="true">
        {LOAD_TEXTS.loading}
      </p>
    );
  }
  if (state.status === "failed") {
    return (
      <div className="store-stack-sm" data-testid="store-status-failed">
        <LoadMessage failure={state.failure} />
        <button
          type="button"
          className="store-btn store-btn--quiet"
          onClick={() => {
            void reload();
          }}
        >
          {LOAD_TEXTS.retry}
        </button>
      </div>
    );
  }
  return <StatusBanner status={state.data.status} />;
};

const LINKS: Array<{ href: string; label: string; note: string }> = [
  { href: "/store/documents", label: "書類", note: "営業許可書とカードの登録" },
  { href: "/store/account", label: "アカウント", note: "メールアドレス・パスワード・退会" },
];

export const StoreMoreLinks = () => (
  <>
    <section className="store-card store-stack-sm" aria-labelledby="store-approval-heading">
      <h2 id="store-approval-heading">承認の状態</h2>
      <ApprovalState />
    </section>
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

export default StoreMoreLinks;
