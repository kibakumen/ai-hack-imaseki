"use client";

// 運営のアカウントの画面の、メールアドレスの確認の案内（2026-09-26 本人選択（AI提示））。
// 店のホームの帯（components/store/EmailVerifyBanner）と同じ部品を、運営の入口で出す。出すかどうかは確認の状態を読む入口
// GET /api/admin/email/verify が決める——verified:false のときだけ出し、確認済み・メールを送る口が無い公開先（入口が 404）・
// 読めなかったときは出さない（何もブロックしない案内なので、読めないときに帯を出して迷わせない）。

import { useEffect, useState } from "react";
import { callApi, isFailure } from "../../lib/client/api";
import { EmailVerifyBanner } from "../store/EmailVerifyBanner";

export const AdminEmailVerify = () => {
  const [unverified, setUnverified] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const result = await callApi("GET /api/admin/email/verify");
      if (alive && !isFailure(result)) setUnverified(!result.verified);
    })();
    return () => {
      alive = false;
    };
  }, []);
  return unverified ? <EmailVerifyBanner endpoint="POST /api/admin/email/verify" /> : null;
};

export default AdminEmailVerify;
