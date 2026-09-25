"use client";

// 公開中のオファーのカード（要件17の基準 17.22・17.12、要件18の基準 18.15、要件19の全部）。
// 出すのは5項目——配信数（＝募集する組数）・残り・何名まで・何時まで・見せているクーポン——と、
// 公開したままできる5つの操作、そして「公開を止める」。
// **残りやさばけた数を店が直接打つ欄は置かない**（基準 18.15）。終わったオファーをもう一度動かす
// 操作も無い（基準 17.15）。
//
// 断りの出し方（設計書「入力の誤りの出し方」の19の行）:
//   - **操作ごとに別の断りを持つ**——押した操作の欄の直下（`msg-<項目名>`）か、その操作のボタンの
//     直下（`msg-form`）にだけ文が出る。ほかの操作の欄には出ない（基準 19.2・19.5・19.9）
//   - その場に留まり、入れた数と時刻は消えず、カードの5項目もそのまま
//   - **`offer_ended` のときだけホームを取り直す**（基準 19.12）——オファーが終わっていれば、
//     カードは消えて公開のフォームに変わる
//
// 2026-09-25 監査の指摘で直したこと（部品は OfferPanelParts・OfferUntilTimer・OfferTrend に分けた）:
//   - 不具合-03 クーポンの選び直しは、差し替えの入口 `POST …/current/coupons` の1文（同じオファーのまま）。
//     それまでは「止める → 公開し直す」の2本で、残りが古いオファーに割れていた
//   - 店-03 「公開を止める」は確かめを1段挟み、向かっている組数がそのまま来ることを伝える
//   - 店-06 スマホの幅でも縦に短く——ダイヤルは2列に並べ、何時までは「終了タイマー」の裏に畳み、クーポンは
//     折り返しの横並びにし、「更新する」は変えたところがある間だけ画面の下に貼り付ける（本人の第2回の指摘）
//   - 店-09 配信数のダイヤルは入口の範囲に合わせる——下は受け取り済みの数（最小1。ただし今の配信数が0なら0）、
//     上は残りが20になるまで。「受付を締める」で残りを0にできる
//   - 不具合-03 のレビュー 選んだクーポンは、札に触っていない間は取り直しのたびにサーバーの値へ合わせる
//   - 店-16 残りが0なら「満席（いまは客に出ていません）」と出し、配信数を足せばまた出ることを添える
//
// 2026-09-25 監査の指摘 設計-16 で分けた（1つの部品が約250行あった。振る舞いは変えていない）:
//   useOfferTuning … 回した値・選んだクーポン・「更新する」の順の送り方・1操作ずつの送信
//   OfferDials     … 配信数と何名までの2本のダイヤル（裏の欄とボタン・断りの文）
//
// ⚠️ **受け入れ検査が掴む4つの `<form>`（`form-add` `form-reduce` `form-party-max` `form-until`）と、
//    その中の `<input>`・ボタンは DOM に残す**。見た目はダイヤルが担い、欄とボタンは目には出さない
//    （`store-sr-only`）——キーボードと読み上げの利用者はこちらで1操作ずつ送れる。
//    断りの文は**その操作の `<form>` の中**に出る（検査が `within(form)` で引く）。

import { useState } from "react";
import type { OfferViewDto } from "../../lib/client/api";
import { FormMessage } from "../ui/InputRefusal";
import { SubmitButton } from "../ui/Submit";
import { CapacityDial, PartyMaxDial } from "./OfferDials";
import { CouponToggles, OfferStatusBadge, Remaining, StopConfirm, type OfferPanelCoupon } from "./OfferPanelParts";
import { OfferTrend, type TrendBucket } from "./OfferTrend";
import { OfferUntilTimer } from "./OfferUntilTimer";
import { useOfferTuning } from "./useOfferTuning";

export type { OfferPanelCoupon } from "./OfferPanelParts";

/** 公開中のオファーのカード（受け入れ検査の契約 `OfferDto`）。型は schemas/responses の表から（設計-07）。 */
export type OfferPanelOffer = OfferViewDto;

type Props = {
  offer: OfferPanelOffer;
  /** 店が登録してある全部のクーポン（見せる・見せないに関わらず）。札にして選べるようにする */
  coupons: OfferPanelCoupon[];
  /** 「今日の動き」——店のホームの応答の15分ごとの数（店-15） */
  trend: readonly TrendBucket[];
  /** 向かっている客（確保中）の組数。「公開を止める」の確かめに出す（店-03） */
  arriving: number;
  /** 変えられたら（止めたら）、店のホームを取り直して数字とフォームを作り直す */
  onChanged: () => void;
};

/**
 * 札に出すクーポンの並び——登録してある全部（作った順）。見せている中に登録の一覧に無いものが
 * 在れば（取り直しの途中など）、落とさずに後ろへ足す。
 */
const couponsToShow = (registered: OfferPanelCoupon[], shown: OfferPanelCoupon[]): OfferPanelCoupon[] => {
  const ids = new Set(registered.map((coupon) => coupon.id));
  return [...registered, ...shown.filter((coupon) => !ids.has(coupon.id))];
};

export const OfferPanel = ({ offer, coupons, trend, arriving, onChanged }: Props) => {
  const tuning = useOfferTuning(offer, onChanged);
  const { changes, pendingCount, sending } = tuning;
  /** 「公開を止める」の確かめを出している */
  const [askingStop, setAskingStop] = useState(false);

  return (
    <section className="store-card store-card--accent store-offer" data-testid="offer-card">
      {/* いちばん上＝「向かっている客」の直下。止める操作を探させない */}
      <div className="store-card__head store-offer__head">
        <div className="store-offer__title">
          <h2>公開中のオファー</h2>
          <OfferStatusBadge remaining={offer.remaining} />
        </div>
        <div className="store-offer__stop">
          <button type="button" className="store-btn store-btn--danger" data-testid="btn-stop" aria-expanded={askingStop} onClick={() => setAskingStop(true)}>
            ■ 公開を止める
          </button>
        </div>
      </div>
      {askingStop ? (
        <StopConfirm
          arriving={arriving}
          onConfirm={() => {
            setAskingStop(false);
            tuning.stopOffer();
          }}
          onCancel={() => setAskingStop(false)}
        />
      ) : null}
      <FormMessage failure={changes.stop.failure} />

      <div className="store-offer__body">
        {/* 回して決めて、「更新する」で一括。残りと「受付を締める」はいちばん上に */}
        <div className="store-tune">
          <Remaining remaining={offer.remaining} onCloseIntake={tuning.closeIntake} sending={sending} />
          {offer.remaining === 0 ? <p className="store-note store-offer__full">配信数を増やすと、また客に出ます。</p> : null}

          <div className="store-tune__dials">
            <CapacityDial offer={offer} tuning={tuning} />
            <PartyMaxDial offer={offer} tuning={tuning} />
          </div>

          <OfferUntilTimer offer={offer} value={tuning.values.until} changed={tuning.untilChanged} failure={changes.until.failure} onChange={tuning.edit.until} onSubmit={tuning.submit.until} />

          <CouponToggles coupons={couponsToShow(coupons, offer.coupons)} selected={tuning.values.couponIds} changed={tuning.couponsChanged} onToggle={tuning.toggleCoupon} />

          {/* 変えたところがある間だけ、画面の下に貼り付く（スマホでも押せる・店-06） */}
          <div
            className={pendingCount === 0 ? "store-tune__foot" : "store-tune__foot store-tune__foot--sticky"}
            data-testid="offer-update-bar"
            data-sticky={String(pendingCount > 0)}
          >
            <p className={pendingCount === 0 ? "store-note" : "store-tune__pending"}>{pendingCount === 0 ? "変えたところはありません" : `${pendingCount} 項目を変えます`}</p>
            <SubmitButton
              type="button"
              className="store-btn store-btn--primary store-tune__apply"
              data-testid="btn-update"
              busy={sending}
              onClick={() => {
                void tuning.applyAll();
              }}
            >
              更新する
            </SubmitButton>
          </div>
          {tuning.nothingToSend ? <p className="store-note">ダイヤルを回すか、時刻を入れるか、クーポンを選び直してから押してください。</p> : null}
          <FormMessage failure={changes.coupons.failure} />
        </div>

        <div className="store-offer__aside">
          <OfferTrend capacity={offer.capacity} remaining={offer.remaining} trend={trend} />
        </div>
      </div>
    </section>
  );
};

export default OfferPanel;
