"use client";

// 店と運営の画面のログアウト（2026-09-25 監査の指摘 安全-09）。店のタブ（StoreNav）の右端と、
// 運営の殻（app/admin/layout）のナビに置く。
//
// 入口 POST /api/auth/logout は在ったのに、画面から呼ぶ所が1つも無かった。セッションは使い続ける限り延びるので、
// 店の共用タブレットや会場の共用 PC では、次に触った人がそのまま客の電話番号を見たり、確保を取り消したりできた。
//
// 押したら入口を呼び、**通ってから** /login へ移す。落ちたら移らずに文を出す——表のセッションが残ったまま
// ログインの画面へ移すと、切れたように見えて切れていない（共用の端末で一番まずい見え方）。
// 移るのは replace（履歴を置き換える）——「戻る」で、ログインしていたときの画面を開き直させないため。
// 読み込み直しにもなるので、画面が手元に持っていた店や運営のデータも残らない。

import { useState } from "react";
import { callApi, isFailure } from "../../lib/client/api";
import { TEXTS } from "../../lib/domain/texts";

const LOGIN_PATH = "/login";

type Props = { className?: string };

export const LogoutButton = ({ className }: Props) => {
  const [busy, setBusy] = useState(false);
  const [failedKind, setFailedKind] = useState<string | null>(null);

  const logout = async () => {
    setBusy(true);
    const result = await callApi("POST /api/auth/logout", { body: {} });
    if (isFailure(result)) {
      setFailedKind(result.error?.kind ?? "network");
      setBusy(false);
      return;
    }
    window.location.replace(LOGIN_PATH);
  };

  return (
    <span className={className ? `logout ${className}` : "logout"}>
      <button
        type="button"
        className="logout__button"
        data-testid="btn-logout"
        disabled={busy}
        onClick={() => {
          void logout();
        }}
      >
        ログアウト
      </button>
      {failedKind !== null && (
        <span className="logout__message" role="alert" data-testid="logout-failed">
          {TEXTS.inputRefusal(failedKind)}
        </span>
      )}
    </span>
  );
};

export default LogoutButton;
