"use client";

// 登録の確認と消去【最終日】（要件28の基準 28.4・28.5・28.9・28.11）。
// 押し間違いで消えないように、確かめ（`confirm-delete`）を挟んでから入口を呼ぶ。
// 断られたときの文は InputRefusal が「登録を消す」の直下に出す（設計書「入力の誤りの出し方」）。
//
// ⚠️ 消えたら端末に残した確保の中身も消す（基準 28.9）。Cookie は入口が Max-Age=0 で消す。

import { useState } from "react";
import { apiCall, isFailure, type ApiFailure } from "../../lib/client/api";
import { clearHome as clearReservationCache } from "../../lib/client/reservationCache";
import { FormMessage } from "../ui/InputRefusal";

type Props = {
  /** 消えたあとに呼ぶ。客の画面は登録の入力へ戻る（基準 28.11） */
  onDeleted: () => void;
};

export const AccountSettings = ({ onDeleted }: Props) => {
  const [confirming, setConfirming] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  const remove = async () => {
    const result = await apiCall("DELETE", "/api/customer");
    // 断られたら確かめを閉じて文だけを残す（表示は消去の前のまま・基準 28.5）。
    setConfirming(false);
    if (isFailure(result)) {
      setFailure(result);
      return;
    }
    setFailure(null);
    clearReservationCache();
    onDeleted();
  };

  return (
    <section data-testid="form-delete" aria-label="登録の確認と消去">
      <h2>登録</h2>
      <p>登録を消すと、呼び名・電話番号・好みのジャンル・予算の上限が消えます。この端末からもう探せなくなり、次に開くと登録からやり直しになります。</p>

      <button type="button" data-testid="btn-delete-account" onClick={() => setConfirming(true)}>
        登録を消す
      </button>
      <FormMessage failure={failure} />

      {confirming && (
        <div data-testid="confirm-delete" role="group" aria-label="登録を消す確かめ">
          <p>本当に消しますか。消したあとに戻すことはできません。</p>
          <button
            type="button"
            data-testid="btn-confirm"
            onClick={() => {
              void remove();
            }}
          >
            消す
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            やめる
          </button>
        </div>
      )}
    </section>
  );
};

export default AccountSettings;
