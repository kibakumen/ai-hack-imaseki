"use client";

// 店のパスワードの変更の画面の中身（2026-09-25 監査の指摘 安全-07・安全-21 の画面の側）。
//
// 入口 POST /api/store/password は、仮のパスワードで入った直後（mustChangePassword）でなければ
// 今のパスワードを求める。画面もそれに合わせ、ホームの入口が返す印で今のパスワードの欄を出し分ける
// ——仮のパスワードで入った店は自分で決めた値を覚えていない（基準 14.14）ので、そこだけは求めない。
//
// 仮のパスワードの店は、決めるまでほかの入口を使えない（安全-21）。そのためタブは出さず、決めたあとに
// ホームへの道を出す。ログアウトはどちらの場面でも使える（共用の端末に残さない・安全-09）。

import { useState } from "react";
import { callApi, type ApiFailure, type StoreHomeDto } from "../../lib/client/api";
import { useLoad } from "../../lib/client/useLoad";
import { LogoutButton } from "../auth/LogoutButton";
import { LoadView } from "../ui/LoadState";
import { PasswordForm } from "./PasswordForm";

const loadHome = (): Promise<StoreHomeDto | ApiFailure> => callApi("GET /api/store/home");

export const StorePasswordPanel = () => {
  const { state, reload } = useLoad(loadHome);
  const [changed, setChanged] = useState(false);

  return (
    <LoadView
      state={state}
      onRetry={() => {
        void reload();
      }}
    >
      {(home) => (
        <>
          {/* 決めたあとも、画面を開いた時の印で欄を出し分けたまま（読み直すと欄が入れ替わって文が消える） */}
          <PasswordForm requireCurrent={!home.mustChangePassword} onChanged={() => setChanged(true)} />
          {changed && (
            <p>
              <a href="/store" data-testid="link-store-home">
                店のホームへ
              </a>
            </p>
          )}
          <LogoutButton />
        </>
      )}
    </LoadView>
  );
};

export default StorePasswordPanel;
