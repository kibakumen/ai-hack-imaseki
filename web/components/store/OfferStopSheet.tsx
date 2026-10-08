"use client";

// 「公開を止める」の確かめのシート（2026-09-25 監査の指摘 店-03 の案A を、2026-10-08 本人選択「案C 片手の親指」の論点2 の形にした）。
// 止めたオファーは再開できず（要件17の基準 17.15）、止めても確保は取り消されない（基準 17.16）。向かっている組を
// 名前と確保番号つきで並べて「そのまま来店します」と伝え、席を空けてしまう思い違いを防ぐ。
//
// 止め方は2つ。親指の横の動き1本の「右へすべらせて止める」と、すべらせにくい人のための普通のボタン「確かめて止める」
// （後者はモックに無い・2026-10-08 の依頼で足した）。親指にいちばん近い底には安全な「やめる」を置く。

import type { ArrivalDto } from "../../lib/client/api";
import { ARRIVALS_TEXTS, TERMS } from "../../lib/domain/texts";
import { timeInJst } from "../ui/jstTime";
import { codeInGroups } from "./ArrivalCard";
import { BottomSheet } from "./BottomSheet";
import { SlideToStop } from "./SlideToStop";

type Props = {
  open: boolean;
  /** 向かっている客（確保中の行） */
  arriving: readonly ArrivalDto[];
  onConfirm: () => void;
  onCancel: () => void;
};

export const OfferStopSheet = ({ open, arriving, onConfirm, onCancel }: Props) => (
  <BottomSheet
    open={open}
    onClose={onCancel}
    label="公開を止める確かめ"
    testId="confirm-stop"
    foot={
      <>
        <SlideToStop label="右へすべらせて止める" knobLabel="右へすべらせて公開を止める（キーボードは右矢印を4回）" onComplete={onConfirm} />
        <div className="store-sheet__buttons">
          <button type="button" className="store-btn store-btn--danger-text" data-testid="btn-confirm-stop" onClick={onConfirm}>
            確かめて止める
          </button>
          <button type="button" className="store-btn store-btn--text store-btn--wide" onClick={onCancel}>
            やめる
          </button>
        </div>
      </>
    }
  >
    <p className="store-sheet__title">このオファーを止めますか</p>
    <p className="store-sheet__strong">止めると、このオファーは再開できません。</p>
    {arriving.length > 0 ? (
      <div className="store-warn">
        <p className="store-warn__lead">向かっている {arriving.length} 組は、そのまま来店します</p>
        <ul className="store-warn__list">
          {arriving.map((row) => (
            <li key={row.reservationId}>
              <span className="store-party store-party--sm">{row.party}</span>
              <span>
                {ARRIVALS_TEXTS.who(row.nickname)}
                <small>
                  {TERMS.reservationCode} {codeInGroups(row.code)}・期限 {timeInJst(row.expiresAt)}
                </small>
              </span>
            </li>
          ))}
        </ul>
        <p className="store-note">確保はキャンセルされません。席の用意はそのまま続けてください。</p>
      </div>
    ) : (
      <p className="store-note">いま向かっているお客さまはいません。</p>
    )}
    <p className="store-note">また出すときは、今の内容が入った公開のフォームからすぐに出し直せます。</p>
  </BottomSheet>
);

export default OfferStopSheet;
