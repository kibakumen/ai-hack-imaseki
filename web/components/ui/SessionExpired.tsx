"use client";

// 「ログインが切れました」と /login への道（2026-09-25 監査の指摘 横断-01）。
//
// 店と運営の画面の殻（app/store/layout・app/admin/layout）に1つずつ置く。どの読み込み・操作で
// 401（unauthenticated）を受けても、client/api の知らせでここに出る——画面ごとに 401 を場合分けしない。
// セッションは最後に延長されてから25時間で切れ、運営が仮のパスワードを発行したときも店の画面は全部切れる。
// 客の画面には置かない（客にはログインが無い）。

import { useSessionExpired } from "../../lib/client/useSessionExpired";
import { LOAD_TEXTS, TEXTS } from "../../lib/domain/texts";

export const SessionExpiredNotice = () => {
  const expired = useSessionExpired();
  if (!expired) return null;
  return (
    <div className="session-expired" role="alert" data-testid="session-expired">
      <p>{TEXTS.inputRefusal("unauthenticated")}</p>
      <a href="/login" data-testid="link-relogin">
        {LOAD_TEXTS.relogin}
      </a>
    </div>
  );
};
