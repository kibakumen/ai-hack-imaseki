"use client";

// 確保中の表示に置く2つの操作（要件10）——確保を取り消す（基準 10.1・10.2）と、人数を変える
// （基準 10.4〜10.9）。**確保中の表示（`ReservationView`）の中に置く部品**で、コードや店名などの
// 表示そのものは持たない（それは要件9の側）。
//
// 取り消しは**確かめを1段挟む**（押し間違いで席を手放さないため・AI判断。運営の停止〔`StoreDetail`〕
// と同じ `confirm-<action>` ＋ `btn-confirm` の形に揃えた）。
//
// 断りの出し方（設計書「入力の誤りの出し方」の 10.5・10.7・10.8 の行）:
//   - 人数の範囲の誤り（基準 10.5）は**人数の欄の直下**（`msg-party`）
//   - 「何名まで」を超える増やす変更（基準 10.7）は**操作の直下**（`msg-form`）で、文は
//     取り消して探し直す手まで示す（基準 10.8・文の正本は `domain/texts` の `party_over_max`）
//   - どちらもその場に留まり、表示の人数は元のまま（変わるのは通ったときだけ）
//
// ⚠️ 応答の `home` を**そのまま親へ渡す**（取り直さない）。取り消しの直後は取得の画面、人数の
//    変更の直後は新しい人数が入っている（設計書「入口の一覧」の注と同じ考え——理由と新しい状態を
//    1つの応答で返し、画面はそれで自分を作り直す。往復は1回のまま）。
//    今の状態と衝突して断られたときは `home` を渡さずに呼ぶ＝親がホームを取り直す（基準 9.8・10.3）。

import { useState, type FormEvent } from "react";
import { callApi, isFailure } from "../../lib/client/api";
import { SUBMIT_TEXTS, TERMS } from "../../lib/domain/texts";
import { PARTY_MAX, PARTY_MIN } from "../../lib/schemas/limits";
import { FieldMessage, FormMessage, fieldAria, type RefusalContext } from "../ui/InputRefusal";
import { SubmitButton } from "../ui/Submit";
import { useSubmit } from "../ui/useSubmit";

/** この部品が読む確保の項目だけ（表示の全部は `ReservationView` が持つ）。 */
export type ReservationActionsReservation = { id: string; party: number };

/**
 * 操作が通ったときの新しいホームと、済んだことを伝える1文（親が画面の上に出す・2026-09-25 監査の指摘 横断-03。
 * 取り消しは取得の画面へ切り替わるので、この部品の中には出せない）。今の状態と衝突したときは何も渡さず、親がホームを取り直す。
 */
type OnChanged = (home?: unknown, done?: string) => void;

/** 人数の欄の断りの文に入れる値（範囲の数字は `schemas/limits` から渡す）。 */
const PARTY_CTX: RefusalContext = { field: "人数", min: PARTY_MIN, max: PARTY_MAX };

/**
 * 1つの操作ぶんの送信と、その操作の断り。**操作ごとに別に持つ**ので、人数の変更の断りが
 * 取り消しの側に出ることはない（設計書「入力の誤りの出し方」の規則）。送っている間は押せない（横断-03）。
 */
const useReservationOperation = (reservationId: string, action: "cancel" | "party", onChanged: OnChanged) => {
  const operation = useSubmit();

  const submit = async (body: Record<string, unknown>, done: string): Promise<void> => {
    const result = await operation.run(() => callApi(`POST /api/customer/reservations/:id/${action}` as const, { params: { id: reservationId }, body }));
    if (result === null) return;
    if (!isFailure(result)) {
      onChanged(result.home, done);
      return;
    }
    // 画面は移らず、入れた内容もそのまま（設計書「入力の誤りの出し方」の規則3）。
    // 確保中でなくなっていた（期限が切れた・店が取り消した）。最新の状態を出し直す（基準 10.3・9.8）。
    if (result.current) onChanged();
  };

  return { failure: operation.failure, busy: operation.busy, submit };
};

/** 人数を変える（要件10の基準 10.4〜10.9）。 */
const PartyForm = ({ reservationId, party: current, onChanged }: { reservationId: string; party: number; onChanged: OnChanged }) => {
  const { failure, busy, submit } = useReservationOperation(reservationId, "party", onChanged);
  const [party, setParty] = useState(String(current));

  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // 空欄は項目を載せない（入口が「入れてください」と答える）。数にならない文字はそのまま載せる。
    const value = party.trim() === "" ? undefined : Number.isNaN(Number(party)) ? party : Number(party);
    void submit({ party: value }, SUBMIT_TEXTS.partyChanged(Number(party)));
  };

  return (
    <form data-testid="form-party" noValidate onSubmit={send}>
      <label htmlFor="reservation-party-field">人数を変える</label>
      <input
        id="reservation-party-field"
        data-testid="field-party"
        type="number"
        inputMode="numeric"
        min={PARTY_MIN}
        max={PARTY_MAX}
        value={party}
        onChange={(event) => setParty(event.target.value)}
        {...fieldAria("party", failure, "reservation-party-field")}
      />
      <FieldMessage inputId="reservation-party-field" name="party" failure={failure} ctx={PARTY_CTX} />
      <SubmitButton type="submit" data-testid="btn-change-party" busy={busy}>
        人数を変える
      </SubmitButton>
      <FormMessage failure={failure} fieldNames={["party"]} ctx={PARTY_CTX} />
    </form>
  );
};

/** 確保を取り消す（要件10の基準 10.1・10.2）。押し間違いで席を手放さないよう確かめを1段挟む。 */
const CancelButton = ({ reservationId, onChanged }: { reservationId: string; onChanged: OnChanged }) => {
  const { failure, busy, submit } = useReservationOperation(reservationId, "cancel", onChanged);
  const [confirming, setConfirming] = useState(false);

  return (
    <div data-testid="form-cancel">
      <button type="button" data-testid="btn-cancel" onClick={() => setConfirming(true)}>
        確保をキャンセル
      </button>
      {confirming && (
        <div className="claim-confirm" data-testid="confirm-cancel" role="group" aria-label="キャンセルする前の確かめ">
          <p>この確保をキャンセルすると、{TERMS.reservationCode}は使えなくなります。キャンセルしますか。</p>
          {/* 送り終えるまで確かめを開いたままにし、「取り消す」を止める（横断-03。閉じてから送ると2度押せた） */}
          <SubmitButton
            type="button"
            data-testid="btn-confirm"
            busy={busy}
            onClick={() => {
              void submit({}, SUBMIT_TEXTS.reservationCancelled).then(() => setConfirming(false));
            }}
          >
            キャンセルする
          </SubmitButton>
          <button type="button" disabled={busy} onClick={() => setConfirming(false)}>
            やめる
          </button>
        </div>
      )}
      <FormMessage failure={failure} />
    </div>
  );
};

// ⚠️ ここは以前**クラスも余白も持たない素の `<div>`** で、人数の変更と取り消しが
// 確保の札に貼り付いて見えていた（2026-09-22 の本人の指摘「確保を取り消すボタンがカードと近すぎます」）。
// 余白は `me.css` の `.claim-actions` が持つ。
export const ReservationActions = ({ reservation, onChanged }: { reservation: ReservationActionsReservation; onChanged: OnChanged }) => (
  <div className="claim-actions">
    <PartyForm reservationId={reservation.id} party={reservation.party} onChanged={onChanged} />
    <CancelButton reservationId={reservation.id} onChanged={onChanged} />
  </div>
);

export default ReservationActions;
