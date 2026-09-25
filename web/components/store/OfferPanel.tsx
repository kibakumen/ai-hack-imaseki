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
// ⚠️ **受け入れ検査が掴む4つの `<form>`（`form-add` `form-reduce` `form-party-max` `form-until`）と、
//    その中の `<input>`・ボタンは DOM に残す**。見た目はダイヤルが担い、欄とボタンは目には出さない
//    （`store-sr-only`）——キーボードと読み上げの利用者はこちらで1操作ずつ送れる。
//    断りの文は**その操作の `<form>` の中**に出る（検査が `within(form)` で引く）。

import { useState, type FormEvent } from "react";
import type { OfferViewDto } from "../../lib/client/api";
import { OFFER_CAPACITY_MAX, OFFER_CAPACITY_MIN, OFFER_PARTY_MAX_MAX, OFFER_PARTY_MAX_MIN } from "../../lib/schemas/limits";
import { FieldMessage, FormMessage, fieldAria, type RefusalContext } from "../ui/InputRefusal";
import { timeInJst } from "../ui/jstTime";
import { useOfferChange, type OfferChange, type Outcome } from "./offerChange";
import { CouponToggles, HiddenControl, NextValue, OfferStatusBadge, Remaining, StopConfirm, type OfferPanelCoupon } from "./OfferPanelParts";
import { OfferTrend, type TrendBucket } from "./OfferTrend";
import { OfferUntilTimer } from "./OfferUntilTimer";
import { Wheel } from "./WheelPicker";

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

/** 空欄は項目を載せない（入口が「入れてください」と答える）。数にならない文字はそのまま載せる。 */
const numberToSend = (text: string): number | string | undefined => {
  if (text.trim() === "") return undefined;
  const value = Number(text);
  return Number.isNaN(value) ? text : value;
};

/** 打った文字を、ダイヤルの差の計算に使える数にする。空欄・数でない文字は 0（＝動かしていない）。 */
const countOf = (text: string): number => {
  if (text.trim() === "") return 0;
  const value = Number(text);
  return Number.isNaN(value) ? 0 : value;
};

/** 2つの番号の集まりが同じか（並びは問わない）。 */
const sameIds = (a: string[], b: string[]): boolean => a.length === b.length && a.every((id) => b.includes(id));

/**
 * 札に出すクーポンの並び——登録してある全部（作った順）。見せている中に登録の一覧に無いものが
 * 在れば（取り直しの途中など）、落とさずに後ろへ足す。
 */
const couponsToShow = (registered: OfferPanelCoupon[], shown: OfferPanelCoupon[]): OfferPanelCoupon[] => {
  const ids = new Set(registered.map((coupon) => coupon.id));
  return [...registered, ...shown.filter((coupon) => !ids.has(coupon.id))];
};

/**
 * 配信数のダイヤルの範囲（2026-09-25 監査の指摘 店-09）。入口の規則に合わせる——減らせるのは残りまで（基準 19.5）
 * なので下は**受け取り済みの数**（配信数 − 残り・最小1）、足したあとの残りは20まで（基準 19.2）なので上は
 * **配信数 ＋（20 − 残り）**。それまでは 1〜20 で回せて、配信数10・残り2 の店では選べる 1〜7 がどれも断られた。
 *
 * ⚠️ **範囲には今の配信数を必ず含める**（2026-09-25 のレビュー）。誰も受け取っていないオファーで「受付を締める」を
 *    押すと配信数は0になる。下限を1のままにすると、ダイヤルは範囲の外の「0」ではなく「1」に印を付けて描き
 *    （実際と違う値を指して見える・店-04 と同じ種類の症状）、▲も押せなかった。
 */
const capacityRange = (offer: { capacity: number; remaining: number }) => {
  const sold = Math.max(0, offer.capacity - offer.remaining);
  return {
    sold,
    min: Math.min(offer.capacity, Math.max(OFFER_CAPACITY_MIN, sold)),
    max: Math.max(offer.capacity, offer.capacity + (OFFER_CAPACITY_MAX - offer.remaining)),
  };
};

/**
 * 見せるクーポンの選択。`touched` は札に触って、まだ送っていない間だけ true。`seenKey` は最後に合わせた
 * サーバーの値（番号を「,」でつないだもの）。
 */
type CouponPick = { ids: string[]; touched: boolean; seenKey: string };

export const OfferPanel = ({ offer, coupons, trend, arriving, onChanged }: Props) => {
  const stop = useOfferChange("stop");
  const add = useOfferChange("add");
  const reduce = useOfferChange("reduce");
  const partyMaxChange = useOfferChange("party-max");
  const untilChange = useOfferChange("until");
  const couponsChange = useOfferChange("coupons");

  // 打った（回した）値。空欄は「変えていない」。⚠️ 丸めない・範囲へ寄せない（断られた値をそのまま残す）
  const [addCount, setAddCount] = useState("");
  const [reduceCount, setReduceCount] = useState("");
  const [partyMax, setPartyMax] = useState("");
  const [until, setUntil] = useState("");
  // 選んだクーポン。初めは今見せているもの。**札に触っていない間は、取り直しのたびにサーバーの今の値へ合わせる**
  // （2026-09-25 のレビュー）。選び直しが同じオファーのままになった（不具合-03）ので、取り直しでカードは作り直されない。
  // 描き始めの1回だけで作っていたときは、別の端末で選び直されても古い選択が残り、触っていないのに「1 項目を変えます」が
  // 出て、そのまま「更新する」を押すと別の端末の選び直しを黙って戻していた。
  const serverCouponIds = offer.coupons.map((coupon) => coupon.id);
  const serverCouponKey = serverCouponIds.join(",");
  const [couponPick, setCouponPick] = useState<CouponPick>(() => ({ ids: serverCouponIds, touched: false, seenKey: serverCouponKey }));
  if (couponPick.seenKey !== serverCouponKey) {
    // 描く途中で合わせる（props が変わったときに state を合わせる React の形。effect で後から直すと、古い選択で1回描く）
    setCouponPick((current) => ({ ids: current.touched ? current.ids : serverCouponIds, touched: current.touched, seenKey: serverCouponKey }));
  }
  const couponIds = couponPick.ids;
  /** 「更新する」を押したが、変えたところが無かった */
  const [nothingToSend, setNothingToSend] = useState(false);
  const [sending, setSending] = useState(false);
  /** 「公開を止める」の確かめを出している */
  const [askingStop, setAskingStop] = useState(false);

  const range = capacityRange(offer);

  // ダイヤルが指す値。配信数は「今の配信数 ＋ 追加 − 減らす」——1つのダイヤルを add と reduce の2つの
  // 入口へ振り分ける（増やせば add・減らせば reduce）。裏の欄に直接打った値もここへ合流する。
  const capacityDelta = countOf(addCount) - countOf(reduceCount);
  const capacityTarget = offer.capacity + capacityDelta;
  const partyTarget = partyMax === "" ? String(offer.partyMax) : partyMax;

  const capacityChanged = addCount !== "" || reduceCount !== "";
  const partyChanged = partyMax !== "" && partyMax !== String(offer.partyMax);
  const untilChanged = until !== "" && until !== timeInJst(offer.untilAt);
  const couponsChanged = !sameIds(couponIds, serverCouponIds);
  const pendingCount = [capacityChanged, partyChanged, untilChanged, couponsChanged].filter(Boolean).length;

  const dialCapacity = (next: string) => {
    const delta = Number(next) - offer.capacity;
    setAddCount(delta > 0 ? String(delta) : "");
    setReduceCount(delta < 0 ? String(-delta) : "");
    setNothingToSend(false);
  };
  const dialPartyMax = (next: string) => {
    setPartyMax(next);
    setNothingToSend(false);
  };
  const toggleCoupon = (id: string) => {
    setCouponPick((current) => {
      const ids = current.ids.includes(id) ? current.ids.filter((value) => value !== id) : [...current.ids, id];
      // 触ってサーバーの値と同じに戻したら、また取り直しに合わせる側へ戻す
      return { ...current, ids, touched: !sameIds(ids, serverCouponIds) };
    });
    setNothingToSend(false);
  };

  const ctxCount = (field: string): RefusalContext => ({ field, min: OFFER_CAPACITY_MIN, max: OFFER_CAPACITY_MAX, remaining: offer.remaining, sold: range.sold });
  const ctxParty: RefusalContext = { field: "何名まで", min: OFFER_PARTY_MAX_MIN, max: OFFER_PARTY_MAX_MAX };

  /** 1操作ぶんを送る。通ったらその欄を空に戻す。 */
  const sendOne = async (change: OfferChange, body: Record<string, unknown>, reset: () => void): Promise<Outcome> => {
    const outcome = await change.send(body);
    if (outcome === "ok") reset();
    return outcome;
  };
  /** 通ったか、終わっていたらホームを取り直す（基準 19.12）。 */
  const afterOne = (outcome: Outcome) => {
    if (outcome !== "refused") onChanged();
  };
  const submitWith = (run: () => Promise<Outcome>) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run().then(afterOne);
  };

  /** 目に出さない1操作ずつの送信（キーボード・読み上げ・受け入れ検査）。 */
  const submitAdd = submitWith(() => sendOne(add, { count: numberToSend(addCount) }, () => setAddCount("")));
  const submitReduce = submitWith(() => sendOne(reduce, { count: numberToSend(reduceCount) }, () => setReduceCount("")));
  const submitPartyMax = submitWith(() => sendOne(partyMaxChange, { partyMax: numberToSend(partyMax) }, () => setPartyMax("")));
  const submitUntil = submitWith(() => sendOne(untilChange, { until }, () => setUntil("")));

  /** 「受付を締める」——残りの数だけ減らす（店-09）。 */
  const closeIntake = () => {
    setSending(true);
    void sendOne(reduce, { count: offer.remaining }, () => setReduceCount("")).then((outcome) => {
      setSending(false);
      afterOne(outcome);
    });
  };

  /** 「公開を止める」を確かめたあと（店-03）。 */
  const confirmStop = () => {
    setAskingStop(false);
    void stop.send({}).then(afterOne);
  };

  /**
   * 「更新する」——変えたものだけを、公開中の5つの入口へ**順に**送る。
   * 断られた操作の文はその操作の欄の下に残り、通った操作の欄は空に戻る。
   * 全部済んでから1回だけホームを取り直す。途中でオファーが終わっていたら、そこで止めて取り直す。
   * クーポンは差し替えの入口の1文（同じオファーのまま・不具合-03）。
   */
  const applyAll = async () => {
    const steps: Array<() => Promise<Outcome>> = [];
    if (addCount !== "") steps.push(() => sendOne(add, { count: numberToSend(addCount) }, () => setAddCount("")));
    if (reduceCount !== "") steps.push(() => sendOne(reduce, { count: numberToSend(reduceCount) }, () => setReduceCount("")));
    if (partyChanged) steps.push(() => sendOne(partyMaxChange, { partyMax: numberToSend(partyMax) }, () => setPartyMax("")));
    if (untilChanged) steps.push(() => sendOne(untilChange, { until }, () => setUntil("")));
    // 通ったら「送っていない選択」ではなくなる——次の取り直しからサーバーの値に合わせる（選択は送った値のまま待つ）
    if (couponsChanged) steps.push(() => sendOne(couponsChange, { couponIds }, () => setCouponPick((current) => ({ ...current, touched: false }))));
    if (steps.length === 0) {
      setNothingToSend(true);
      return;
    }
    setNothingToSend(false);
    setSending(true);
    let reload = false;
    for (const step of steps) {
      const outcome = await step();
      if (outcome === "ok") reload = true;
      if (outcome === "ended") {
        reload = true;
        break;
      }
    }
    setSending(false);
    if (reload) onChanged();
  };

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
      {askingStop ? <StopConfirm arriving={arriving} onConfirm={confirmStop} onCancel={() => setAskingStop(false)} /> : null}
      <FormMessage failure={stop.failure} />

      <div className="store-offer__body">
        {/* 回して決めて、「更新する」で一括。残りと「受付を締める」はいちばん上に */}
        <div className="store-tune">
          <Remaining remaining={offer.remaining} onCloseIntake={closeIntake} sending={sending} />
          {offer.remaining === 0 ? <p className="store-note store-offer__full">配信数を増やすと、また客に出ます。</p> : null}

          <div className="store-tune__dials">
            <div className={capacityChanged ? "store-tune__dial store-tune__dial--changed" : "store-tune__dial"} data-testid="dial-capacity">
              <p className="store-label">配信数</p>
              <Wheel min={range.min} max={range.max} value={String(capacityTarget)} onChange={dialCapacity} unit="組" size="lg" />
              {/* ダイヤルは今の値を指しているので、「今 → 次」は変えたときだけ出す（縦を詰める・店-06） */}
              {capacityChanged ? <NextValue now={String(offer.capacity)} next={String(capacityTarget)} unit=" 組" /> : null}
              {range.sold > 0 ? <p className="store-note store-tune__floor">受け取り済みの {range.sold} 組より下げられません</p> : null}
              <form className="store-tune__form" data-testid="form-add" noValidate onSubmit={submitAdd}>
                <HiddenControl
                  action="add"
                  inputId="offer-add-count"
                  testId="field-count"
                  label="追加で出す組数"
                  button="追加で出す"
                  type="number"
                  min={OFFER_CAPACITY_MIN}
                  max={OFFER_CAPACITY_MAX}
                  value={addCount}
                  onChange={(next) => {
                    setAddCount(next);
                    setNothingToSend(false);
                  }}
                  aria={fieldAria("count", add.failure, "offer-add-count")}
                />
                <FieldMessage inputId="offer-add-count" name="count" failure={add.failure} ctx={ctxCount("追加で出す組数")} />
                <FormMessage failure={add.failure} fieldNames={["count"]} ctx={ctxCount("追加で出す組数")} />
              </form>
              <form className="store-tune__form" data-testid="form-reduce" noValidate onSubmit={submitReduce}>
                <HiddenControl
                  action="reduce"
                  inputId="offer-reduce-count"
                  testId="field-count"
                  label="減らす組数"
                  button="残りを減らす"
                  type="number"
                  min={OFFER_CAPACITY_MIN}
                  max={OFFER_CAPACITY_MAX}
                  value={reduceCount}
                  onChange={(next) => {
                    setReduceCount(next);
                    setNothingToSend(false);
                  }}
                  aria={fieldAria("count", reduce.failure, "offer-reduce-count")}
                />
                <FieldMessage inputId="offer-reduce-count" name="count" failure={reduce.failure} ctx={ctxCount("減らす組数")} />
                <FormMessage failure={reduce.failure} fieldNames={["count"]} ctx={ctxCount("減らす組数")} />
              </form>
            </div>

            <div className={partyChanged ? "store-tune__dial store-tune__dial--changed" : "store-tune__dial"}>
              <p className="store-label">何名まで</p>
              <Wheel min={OFFER_PARTY_MAX_MIN} max={OFFER_PARTY_MAX_MAX} value={partyTarget} onChange={dialPartyMax} unit="名" size="lg" />
              {partyChanged ? <NextValue now={String(offer.partyMax)} next={partyMax} unit=" 名" /> : null}
              <form className="store-tune__form" data-testid="form-party-max" noValidate onSubmit={submitPartyMax}>
                <HiddenControl
                  action="party-max"
                  inputId="offer-party-max"
                  testId="field-partyMax"
                  label="何名までを変える"
                  button="変える"
                  type="number"
                  min={OFFER_PARTY_MAX_MIN}
                  max={OFFER_PARTY_MAX_MAX}
                  value={partyMax}
                  onChange={dialPartyMax}
                  aria={fieldAria("partyMax", partyMaxChange.failure, "offer-party-max")}
                />
                <FieldMessage inputId="offer-party-max" name="partyMax" failure={partyMaxChange.failure} ctx={ctxParty} />
                <FormMessage failure={partyMaxChange.failure} fieldNames={["partyMax"]} ctx={ctxParty} />
              </form>
            </div>
          </div>

          <OfferUntilTimer
            offer={offer}
            value={until}
            changed={untilChanged}
            failure={untilChange.failure}
            onChange={(next) => {
              setUntil(next);
              setNothingToSend(false);
            }}
            onSubmit={submitUntil}
          />

          <CouponToggles coupons={couponsToShow(coupons, offer.coupons)} selected={couponIds} changed={couponsChanged} onToggle={toggleCoupon} />

          {/* 変えたところがある間だけ、画面の下に貼り付く（スマホでも押せる・店-06） */}
          <div
            className={pendingCount === 0 ? "store-tune__foot" : "store-tune__foot store-tune__foot--sticky"}
            data-testid="offer-update-bar"
            data-sticky={String(pendingCount > 0)}
          >
            <p className={pendingCount === 0 ? "store-note" : "store-tune__pending"}>{pendingCount === 0 ? "変えたところはありません" : `${pendingCount} 項目を変えます`}</p>
            <button
              type="button"
              className="store-btn store-btn--primary store-tune__apply"
              data-testid="btn-update"
              disabled={sending}
              onClick={() => {
                void applyAll();
              }}
            >
              {sending ? "送っています…" : "更新する"}
            </button>
          </div>
          {nothingToSend ? <p className="store-note">ダイヤルを回すか、時刻を入れるか、クーポンを選び直してから押してください。</p> : null}
          <FormMessage failure={couponsChange.failure} />
        </div>

        <div className="store-offer__aside">
          <OfferTrend capacity={offer.capacity} remaining={offer.remaining} trend={trend} />
        </div>
      </div>
    </section>
  );
};

export default OfferPanel;
