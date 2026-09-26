"use client";

// 客の画面の下端の「この端末の登録を消す」（要件28の基準 28.4・28.5・28.9・28.11【最終日】）。
//
// 2026-09-25 監査の指摘 安全-15 の案A で戻した。2026-09-22 に「客の情報は残さない想定なので要らない」として
// 登録の確認と消去の画面を撤去したが、実際には入れた電話番号は残り（Cookie の寿命は400日）、取得のたびに起点の
// 緯度経度が記録に入り、通知の宛先も残っていた。本人の前提（残さない）に実装を寄せる手段として、**消す操作だけ**を
// 下端に1つ置く（登録の確認の画面は戻さない——「登録いる？」の方向を守る）。
//
// 押し間違いで消えないように、確かめ（`confirm-delete`）を挟んでから入口を呼ぶ。断られたときの文
// （確保中は先に取り消す・基準 28.5）は InputRefusal が「消す」の直下に出す（設計書「入力の誤りの出し方」）。
// 消えたら端末に残した確保の中身と、現在地を開いた瞬間に入れる覚えも消す（基準 28.9）。Cookie は入口が Max-Age=0 で消す。

import { useState } from "react";
import { callApi, isFailure } from "../../lib/client/api";
import { forgetLocationConsent } from "../../lib/client/locationStatus";
import { clearHome as clearReservationCache } from "../../lib/client/reservationCache";
import { FormMessage } from "../ui/InputRefusal";
import { SubmitButton } from "../ui/Submit";
import { useSubmit } from "../ui/useSubmit";

type EraseRegistrationProps = {
  /** 消えたあとに呼ぶ。客の画面は登録の入力へ戻る（基準 28.11） */
  onDeleted: () => void;
};

export const EraseRegistration = ({ onDeleted }: EraseRegistrationProps) => {
  const [confirming, setConfirming] = useState(false);
  // 送っている間は「消す」を止める（全画面で共通の components/ui/useSubmit・横断-03）
  const erase = useSubmit();
  const failure = erase.failure;

  const remove = async () => {
    const result = await erase.run(() => callApi("DELETE /api/customer"));
    if (result === null) return;
    // 断られたら確かめを閉じて文だけを残す（表示は消去の前のまま・基準 28.5）。
    setConfirming(false);
    if (isFailure(result)) return;
    clearReservationCache();
    forgetLocationConsent();
    onDeleted();
  };

  return (
    <section className="erase-registration" data-testid="form-delete" aria-label="この端末の登録を消す">
      <button type="button" className="erase-registration__open" data-testid="btn-delete-account" onClick={() => setConfirming(true)}>
        この端末の登録を消す
      </button>
      <FormMessage failure={failure} />

      {confirming ? (
        <div className="erase-registration__confirm" data-testid="confirm-delete" role="group" aria-label="登録を消す前の確かめ">
          <p>
            呼び名・電話番号・好みのジャンル・予算の上限と、通知の宛先を消します。この端末からは探せなくなり、次に開くとはじめからになります。
            探したときの記録（探した場所など）は集計のために残ります。消したあとに戻すことはできません。
          </p>
          <SubmitButton type="button" data-testid="btn-confirm" busy={erase.busy} onClick={() => void remove()}>
            消す
          </SubmitButton>
          <button type="button" disabled={erase.busy} onClick={() => setConfirming(false)}>
            やめる
          </button>
        </div>
      ) : null}
    </section>
  );
};
