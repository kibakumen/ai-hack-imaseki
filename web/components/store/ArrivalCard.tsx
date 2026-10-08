"use client";

// 向かっている客1組ぶんのカード（ArrivalsList から分けた・2026-10-08 本人選択「案C 片手の親指」の形）。
// 部品は描くだけで、出す／出さない・できる操作は入口が決めた値（canComplete・canCancel）に従う。
//
// 形（案C の「向かっている客の行と、キャンセルの置き場所」）:
//   - 上の段に人数の札（大きく・呼び名から切り離して省かない・店-11）、呼び名、確保番号（4桁ずつ区切る）、右端に「⋮」
//   - 中の段に期限・遅れ・電話・確保が持つクーポンの小さな札
//   - 底いっぱいに大きな「完了済みにする」。押すと同じ場所が確かめに変わり、指を動かさずに「はい、完了済みにする」を押せる
//   - 「キャンセル」と「来店なしでキャンセル」は「⋮」の奥の下からのシートに離す（完了のすぐ隣に置かない）
//
// 確かめは押したカードの中に出し、確定のボタンへ焦点を移す（店-01）。断られたときの文もカードの中（店-10）。
// ⚠️ **入れる欄は置かない**（コードを打つ欄も理由の欄も・基準 20.11・21.3）。
// ⚠️ 「⋮」のシートは閉じている間も DOM に残す（`keepMounted`）。確かめを出している間は開いたままにする。

import { useEffect, useRef, useState } from "react";
import type { ApiFailure, ArrivalDto } from "../../lib/client/api";
import { ARRIVALS_TEXTS, TERMS } from "../../lib/domain/texts";
import { ARRIVAL_COMPLETE_GRACE_MS } from "../../lib/schemas/limits";
import { FormMessage } from "../ui/InputRefusal";
import { timeInJst } from "../ui/jstTime";
import { BottomSheet } from "./BottomSheet";
import type { PartyChange } from "./useArrivalSignals";

export type ArrivalAction = "complete" | "store-cancel" | "store-no-show";

/** 押したカードと操作、送っている最中か */
export type Pending = { action: ArrivalAction; row: ArrivalDto; sending: boolean };

/** 断られた操作（どのカードの・どの操作が・どう断られたか。文は操作ごとに選ぶ・店-10） */
export type Refusal = { reservationId: string; action: ArrivalAction; failure: ApiFailure };

/** 確かめの文と、確定のボタンの名前 */
const confirmTextOf = (action: ArrivalAction, row: ArrivalDto): string => {
  if (action === "complete") return ARRIVALS_TEXTS.confirmComplete(ARRIVALS_TEXTS.who(row.nickname), row.party, row.code);
  return action === "store-no-show" ? ARRIVALS_TEXTS.confirmNoShow : ARRIVALS_TEXTS.confirmCancel;
};
const CONFIRM_LABEL_OF: Record<ArrivalAction, string> = { complete: "はい、完了済みにする", "store-cancel": "キャンセルする", "store-no-show": "来店なしでキャンセルする" };

/** 開いた並びに出す、客が取り消した行（10分だけ届く・横断-08） */
export const isCustomerCancelled = (row: ArrivalDto): boolean => row.kind === "customer_cancelled";

/** 遅れている客の行（期限切れで、まだ完了にできる）。止められている店の期限切れは済んだぶんへ回す */
export const isLate = (row: ArrivalDto): boolean => row.kind === "expired" && row.canComplete;

/** 期限から、完了にできる終わりの時刻（日本時間の HH:MM）。 */
const lateUntilOf = (row: ArrivalDto): string => timeInJst(new Date(Date.parse(row.expiresAt) + ARRIVAL_COMPLETE_GRACE_MS).toISOString());

/** 確保番号を4桁ずつに区切る（読み上げて照らし合わせやすく） */
export const codeInGroups = (code: string): string => code.replace(/(\d{4})(?=\d)/g, "$1 ");

type ConfirmProps = { pending: Pending; onConfirm: () => void; onDismiss: () => void };

/**
 * 押す前の確かめ。完了済みは呼び名・人数・コードを出す（基準 20.8）。取り消しは、客に知らせが行くことと、
 * 残りの枠が戻るか戻らないかを示す（基準 21.2・21.8・18.4）。開いたら確定のボタンへ焦点を移す（店-01）。
 */
const ConfirmPanel = ({ pending, onConfirm, onDismiss }: ConfirmProps) => {
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);
  const { action, row, sending } = pending;
  const danger = action !== "complete";
  return (
    <div className={danger ? "store-confirm store-confirm--inline store-confirm--danger" : "store-confirm store-confirm--inline"} role="dialog" aria-label="確かめ" data-testid={`confirm-${action}`}>
      <p className="store-confirm__ask">{confirmTextOf(action, row)}</p>
      {sending ? (
        <p className="store-note" role="status">
          {ARRIVALS_TEXTS.sending}
        </p>
      ) : null}
      <div className="store-confirm__buttons">
        <button type="button" className="store-btn store-btn--text" disabled={sending} onClick={onDismiss}>
          やめる
        </button>
        <button
          ref={confirmRef}
          type="button"
          className={danger ? "store-btn store-btn--danger-fill" : "store-btn store-btn--primary store-btn--xl store-btn--confirm"}
          data-testid="btn-confirm"
          disabled={sending}
          onClick={onConfirm}
        >
          {CONFIRM_LABEL_OF[action]}
        </button>
      </div>
    </div>
  );
};

/** 断りの文。状態による断り（今の状態）と、それ以外の断りで出し口が分かれる（設計書「入口の一覧」の3つの形） */
export const RefusalMessage = ({ refusal }: { refusal: Refusal }) =>
  refusal.failure.current ? (
    <p className="msg" role="alert" data-testid="msg-form">
      {ARRIVALS_TEXTS.refused(refusal.action, refusal.failure.current)}
    </p>
  ) : (
    <FormMessage failure={refusal.failure} />
  );

type CardProps = {
  row: ArrivalDto;
  /** 済んだぶん・客が取り消した行は薄く出す（操作は入口の canComplete・canCancel が決める） */
  done: boolean;
  /** 数秒だけ目立たせる（新しく来た客・今しがた取り消した客） */
  highlighted: boolean;
  partyChange: PartyChange | undefined;
  /** このカードで開いている確かめ（無ければ null） */
  pending: Pending | null;
  /** このカードで断られた操作（無ければ null） */
  refusal: Refusal | null;
  onAsk: (action: ArrivalAction, row: ArrivalDto) => void;
  onConfirm: () => void;
  onDismiss: () => void;
};

const cardClassName = (done: boolean, highlighted: boolean, asking: boolean): string =>
  ["store-arrival", done ? "store-arrival--done" : "", highlighted ? "store-arrival--new" : "", asking ? "store-arrival--asking" : ""].filter(Boolean).join(" ");

/** 期限・遅れ・電話・クーポンの小さな札 */
const ArrivalMeta = ({ row }: { row: ArrivalDto }) => (
  <ul className="store-arrival__chips">
    <li className="store-arrival__meta">
      {ARRIVALS_TEXTS.kindLabel(row.kind, row.noShow === true)}・期限 {timeInJst(row.expiresAt)}
    </li>
    {isLate(row) ? <li className="store-arrival__late">{ARRIVALS_TEXTS.lateUntil(lateUntilOf(row))}</li> : null}
    {/* 登録の無い客に仮の番号の発信のリンクを出さない（横断-02）。客が取り消した行には番号を出さない（横断-08） */}
    {row.kind === "customer_cancelled" ? null : (
      <li className="store-arrival__meta">{row.phone ? <a href={`tel:${row.phone}`}>{row.phone}</a> : ARRIVALS_TEXTS.noPhone}</li>
    )}
    {/* 確保が持つクーポン（客が受諾したときに見ていたもの・2026-09-26 本人発案） */}
    {row.coupons && row.coupons.length > 0 ? (
      <li className="store-arrival__meta" data-testid="arrival-coupons">
        {ARRIVALS_TEXTS.coupons(row.coupons)}
      </li>
    ) : null}
  </ul>
);

/** 「⋮」の奥のシート——店の都合のキャンセルと、来店なしでキャンセル（2026-09-26 本人発案の語のまま） */
const MoreSheet = ({ row, open, onClose, pending, onAsk, onConfirm, onDismiss }: { row: ArrivalDto; open: boolean; onClose: () => void; pending: Pending | null; onAsk: CardProps["onAsk"]; onConfirm: () => void; onDismiss: () => void }) => {
  const sending = pending?.sending === true;
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      label="その他の操作"
      keepMounted
      foot={
        <button type="button" className="store-btn store-btn--text store-btn--wide" onClick={onClose}>
          閉じる
        </button>
      }
    >
      <p className="store-sheet__title">
        {ARRIVALS_TEXTS.who(row.nickname)}・{ARRIVALS_TEXTS.party(row.party)}
      </p>
      <p className="store-sheet__sub">
        {TERMS.reservationCode} {codeInGroups(row.code)}・期限 {timeInJst(row.expiresAt)}
      </p>
      <div className="store-rows">
        <div className="store-row-action">
          <button type="button" className="store-row-action__button" data-testid="btn-store-cancel" disabled={sending} onClick={() => onAsk("store-cancel", row)}>
            {ARRIVALS_TEXTS.cancelButton}
          </button>
          <p className="store-row-action__note">お店の都合。客に知らせが行き、残りの枠は戻りません</p>
        </div>
        <div className="store-row-action">
          <button type="button" className="store-row-action__button" data-testid="btn-store-no-show" disabled={sending} onClick={() => onAsk("store-no-show", row)}>
            {ARRIVALS_TEXTS.noShowButton}
          </button>
          {/* 来店なしのキャンセルだけ枠が戻ることを、ボタンの下で言う（2026-09-26 本人発案（キャンセルの語）） */}
          <p className="store-row-action__note" data-testid="no-show-note">
            {ARRIVALS_TEXTS.noShowNote}
          </p>
        </div>
      </div>
      {pending !== null && pending.action !== "complete" ? <ConfirmPanel pending={pending} onConfirm={onConfirm} onDismiss={onDismiss} /> : null}
    </BottomSheet>
  );
};

/** 客1組ぶんのカード。 */
export const ArrivalCard = ({ row, done, highlighted, partyChange, pending, refusal, onAsk, onConfirm, onDismiss }: CardProps) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const askingComplete = pending?.action === "complete";
  const askingCancel = pending !== null && pending.action !== "complete";
  const who = ARRIVALS_TEXTS.who(row.nickname);
  return (
    <li className={cardClassName(done, highlighted, askingComplete)} data-testid={`row-${row.reservationId}`}>
      <div className="store-arrival__top">
        <p className="store-arrival__party" data-testid="arrival-party">
          {row.party}
          <small>名</small>
        </p>
        <div className="store-arrival__main">
          <p className="store-arrival__name">{who}</p>
          <p className="store-arrival__code">
            {TERMS.reservationCode} <b>{codeInGroups(row.code)}</b>
          </p>
        </div>
        {row.canCancel ? (
          <button type="button" className="store-icon-btn" aria-label={`${who}のその他の操作`} aria-haspopup="dialog" aria-expanded={moreOpen || askingCancel} onClick={() => setMoreOpen(true)}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
              <circle cx="12" cy="5" r="2" fill="currentColor" />
              <circle cx="12" cy="12" r="2" fill="currentColor" />
              <circle cx="12" cy="19" r="2" fill="currentColor" />
            </svg>
          </button>
        ) : null}
      </div>
      <ArrivalMeta row={row} />
      {partyChange ? (
        <p className="store-arrival__changed" role="status" data-testid={`party-changed-${row.reservationId}`}>
          {ARRIVALS_TEXTS.partyChanged(partyChange.from, partyChange.to)}
        </p>
      ) : null}
      {isCustomerCancelled(row) ? (
        <p className="store-arrival__changed" role="status" data-testid={`customer-cancelled-${row.reservationId}`}>
          {ARRIVALS_TEXTS.customerCancelled}
        </p>
      ) : null}
      {pending !== null && pending.action === "complete" ? <ConfirmPanel pending={pending} onConfirm={onConfirm} onDismiss={onDismiss} /> : null}
      {row.canComplete && !askingComplete ? (
        <div className="store-arrival__actions">
          <button type="button" className="store-btn store-btn--primary store-btn--xl" data-testid="btn-complete" disabled={pending?.sending === true} onClick={() => onAsk("complete", row)}>
            完了済みにする
          </button>
        </div>
      ) : null}
      {refusal ? <RefusalMessage refusal={refusal} /> : null}
      {row.canCancel ? (
        <MoreSheet
          row={row}
          open={moreOpen || askingCancel}
          onClose={() => {
            setMoreOpen(false);
            if (askingCancel && pending?.sending !== true) onDismiss();
          }}
          pending={pending}
          onAsk={onAsk}
          onConfirm={() => {
            setMoreOpen(false);
            onConfirm();
          }}
          onDismiss={onDismiss}
        />
      ) : null}
    </li>
  );
};
