"use client";

// 公開中のオファーのカード（要件17の基準 17.22・17.12、要件18の基準 18.15、要件19の全部）。
// 出すのは5項目——配信数（＝募集する組数）・残り・何名まで・何時まで・見せているクーポン——と、
// 公開したままできる4つの操作、そして「公開を止める」。
// **残りやさばけた数を店が直接打つ欄は置かない**（基準 18.15）。クーポンのチェックを変える操作も
// 置かない（基準 19.11——選び直すときは公開を止めて公開し直す）。終わったオファーをもう一度動かす
// 操作も無い（基準 17.15）。
//
// 断りの出し方（設計書「入力の誤りの出し方」の19の行）:
//   - **操作ごとに別の断りを持つ**——押した操作の欄の直下（`msg-<項目名>`）か、その操作のボタンの
//     直下（`msg-form`）にだけ文が出る。ほかの操作の欄には出ない（基準 19.2・19.5・19.9）
//   - その場に留まり、入れた数と時刻は消えず、カードの5項目もそのまま
//   - **`offer_ended` のときだけホームを取り直す**（基準 19.12）——オファーが終わっていれば、
//     カードは消えて公開のフォームに変わる
//
// 見た目は 2026-09-22 の本人の指摘（2回目）を入れた:
//   1. **「公開を止める」はカードのいちばん上**——「向かっている客」の直下に来る。席が埋まった
//      瞬間に押す操作なので、探させない
//   2. **配信数と何名までは縦のダイヤル**で回して決め、**「更新する」1つで一括して送る**。
//      4つの操作の入口（add・reduce・party-max・until）はそのまま——変わったものだけを順に呼ぶ。
//      配信数のダイヤルは「今の配信数との差」を add か reduce に振り分ける（増やせば add・
//      減らせば reduce）。回しても即座には送らない
//   3. 変えた項目には印（`--changed`）と「今 → 次」の文が付く
//   4. 数字は大きく・濃く（差し色は `--color-accent` のまま。別の色は持ち込まない）
//
// ⚠️ **受け入れ検査が掴む4つの `<form>`（`form-add` `form-reduce` `form-party-max` `form-until`）と、
//    その中の `<input>`・ボタンは DOM に残す**。見た目はダイヤルが担い、欄とボタンは目には出さない
//    （`store-sr-only`）——キーボードと読み上げの利用者はこちらで1操作ずつ送れる。
//    断りの文は**その操作の `<form>` の中**に出る（検査が `within(form)` で引く）。

import { useState, type FormEvent } from "react";
import { apiCall, isFailure, type ApiFailure } from "../../lib/client/api";
import { OFFER_CAPACITY_MAX, OFFER_CAPACITY_MIN, OFFER_PARTY_MAX_MAX, OFFER_PARTY_MAX_MIN } from "../../lib/schemas/limits";
import { FieldMessage, FormMessage, type RefusalContext } from "../ui/InputRefusal";
import { OfferTrend, type TrendPoint } from "./OfferTrend";
import { timeInJst } from "../ui/jstTime";
import { Wheel } from "./WheelPicker";

export type OfferPanelOffer = {
  id: string;
  capacity: number;
  remaining: number;
  partyMax: number;
  untilAt: string;
  publishedAt: string;
  coupons: Array<{ id: string; name: string; note: string }>;
  latestUntil: string;
};

type Props = {
  offer: OfferPanelOffer;
  /** 右の「今日の動き」に描く点（溜めるのは店のホーム——カードが作り直されても消えないように） */
  trend: TrendPoint[];
  /** 変えられたら（止めたら）、店のホームを取り直して数字とフォームを作り直す */
  onChanged: () => void;
};

/** 公開したままできる操作（入口 `POST /api/store/offers/current/<action>`）。 */
type OfferAction = "stop" | "add" | "reduce" | "party-max" | "until";

/** 1回の送信の結果。`ended` は「オファーが終わっていた」（ホームを取り直す・基準 19.12）。 */
type Outcome = "ok" | "refused" | "ended";

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

/**
 * 1つの操作ぶんの送信と、その操作の断り。**操作ごとに別に持つ**ので、ある操作の断りが
 * ほかの操作の欄に出ることはない（要件19の基準 19.2・19.5・19.9）。
 * ホームを取り直すかは呼ぶ側が決める（一括で送るときは、全部済んでから1回だけ取り直す）。
 */
const useOfferChange = (action: OfferAction) => {
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  const send = async (body: Record<string, unknown>): Promise<Outcome> => {
    const result = await apiCall("POST", `/api/store/offers/current/${action}`, body);
    if (!isFailure(result)) {
      setFailure(null);
      return "ok";
    }
    // 画面は移らず、入れた内容もそのまま（設計書「入力の誤りの出し方」の規則3）。
    setFailure(result);
    return result.error?.kind === "offer_ended" ? "ended" : "refused";
  };

  return { failure, send };
};

type Change = ReturnType<typeof useOfferChange>;

/** 目に出さない1操作ぶんの欄とボタン（キーボード・読み上げ・受け入れ検査の受け口）。 */
const HiddenControl = ({
  action,
  inputId,
  testId,
  label,
  button,
  type,
  min,
  max,
  value,
  onChange,
}: {
  action: OfferAction;
  inputId: string;
  testId: string;
  label: string;
  button: string;
  type: "number" | "time";
  min?: number;
  max?: number;
  value: string;
  onChange: (next: string) => void;
}) => (
  <div className="store-sr-only">
    <label htmlFor={inputId}>{label}</label>
    <input
      id={inputId}
      data-testid={testId}
      type={type}
      inputMode={type === "number" ? "numeric" : undefined}
      min={min}
      max={max}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
    <button type="submit" data-testid={`btn-${action}`}>
      {button}
    </button>
  </div>
);

/** 今の値と次の値（変えたときだけ矢印つき）。 */
const NextValue = ({ now, next, unit }: { now: string; next: string | null; unit: string }) => (
  <p className={next === null ? "store-tune__delta" : "store-tune__delta store-tune__delta--changed"}>
    <span>
      今 {now}
      {unit}
    </span>
    {next === null ? null : (
      <>
        <span className="store-tune__arrow" aria-hidden="true">
          →
        </span>
        <strong>
          {next}
          {unit}
        </strong>
      </>
    )}
  </p>
);

/**
 * 今の中身の4項目（配信数・残り・何名まで・何時まで）。5つ目の「見せているクーポン」は
 * 数ではないので下の `OfferCoupons` が出す（基準 17.22 の5項目）。
 * ⚠️ 残りは `offer-remaining` の名前で出す——店が打つ欄は置かない（基準 18.15）。
 * 残りは**橙の地に白抜き**でいちばん大きく（店がいちばん見る数）。
 */
const OfferFacts = ({ offer, nextCapacity, nextPartyMax, nextUntil }: { offer: OfferPanelOffer; nextCapacity: number | null; nextPartyMax: string | null; nextUntil: string | null }) => (
  <dl className="store-facts">
    <div className="store-fact store-fact--hero" data-testid="offer-remaining">
      <dt className="store-fact__label">残り</dt>
      <dd className="store-fact__value">
        {offer.remaining}
        <span className="store-fact__unit">組</span>
      </dd>
    </div>
    <div className={nextCapacity === null ? "store-fact" : "store-fact store-fact--changed"}>
      <dt className="store-fact__label">配信数</dt>
      <dd className="store-fact__value">
        {offer.capacity}
        <span className="store-fact__unit">組</span>
        {nextCapacity === null ? null : <span className="store-fact__next">→ {nextCapacity}</span>}
      </dd>
    </div>
    <div className={nextPartyMax === null ? "store-fact" : "store-fact store-fact--changed"}>
      <dt className="store-fact__label">何名まで</dt>
      <dd className="store-fact__value">
        {offer.partyMax}
        <span className="store-fact__unit">名</span>
        {nextPartyMax === null ? null : <span className="store-fact__next">→ {nextPartyMax}</span>}
      </dd>
    </div>
    <div className={nextUntil === null ? "store-fact" : "store-fact store-fact--changed"}>
      <dt className="store-fact__label">何時まで</dt>
      <dd className="store-fact__value store-fact__value--time">
        {timeInJst(offer.untilAt)}
        {nextUntil === null ? null : <span className="store-fact__next">→ {nextUntil}</span>}
      </dd>
    </div>
  </dl>
);

/** 見せているクーポン（読むだけ・札の形）。⚠️ チェックを変える操作は置かない（基準 19.11）。 */
const OfferCoupons = ({ coupons }: { coupons: OfferPanelOffer["coupons"] }) => (
  <div className="store-stack-sm">
    <p className="store-label">見せているクーポン</p>
    {coupons.length === 0 ? (
      <p className="store-empty">クーポンを見せないオファーとして公開しています。</p>
    ) : (
      <div className="store-coupons">
        {coupons.map((coupon) => (
          <span className="store-coupon store-coupon--on store-coupon--static" key={coupon.id}>
            <span className="store-coupon__check" aria-hidden="true">
              ✓
            </span>
            <span className="store-coupon__body">
              <span className="store-coupon__name">{coupon.name}</span>
              {coupon.note === "" ? null : <span className="store-coupon__note">{coupon.note}</span>}
            </span>
          </span>
        ))}
      </div>
    )}
  </div>
);

export const OfferPanel = ({ offer, trend, onChanged }: Props) => {
  const stop = useOfferChange("stop");
  const add = useOfferChange("add");
  const reduce = useOfferChange("reduce");
  const partyMaxChange = useOfferChange("party-max");
  const untilChange = useOfferChange("until");

  // 打った（回した）値。空欄は「変えていない」。⚠️ 丸めない・範囲へ寄せない（断られた値をそのまま残す）
  const [addCount, setAddCount] = useState("");
  const [reduceCount, setReduceCount] = useState("");
  const [partyMax, setPartyMax] = useState("");
  const [until, setUntil] = useState("");
  /** 「更新する」を押したが、変えたところが無かった */
  const [nothingToSend, setNothingToSend] = useState(false);
  const [sending, setSending] = useState(false);

  const nowUntil = timeInJst(offer.untilAt);
  const publishedAt = timeInJst(offer.publishedAt);
  const latestUntil = timeInJst(offer.latestUntil);

  // ダイヤルが指す値。配信数は「今の配信数 ＋ 追加 − 減らす」——1つのダイヤルを add と reduce の2つの
  // 入口へ振り分ける（増やせば add・減らせば reduce）。裏の欄に直接打った値もここへ合流する。
  const capacityDelta = countOf(addCount) - countOf(reduceCount);
  const capacityTarget = offer.capacity + capacityDelta;
  const partyTarget = partyMax === "" ? String(offer.partyMax) : partyMax;

  const capacityChanged = addCount !== "" || reduceCount !== "";
  const partyChanged = partyMax !== "" && partyMax !== String(offer.partyMax);
  const untilChanged = until !== "" && until !== nowUntil;

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

  const ctxCount = (field: string): RefusalContext => ({ field, min: OFFER_CAPACITY_MIN, max: OFFER_CAPACITY_MAX, remaining: offer.remaining });
  const ctxParty: RefusalContext = { field: "何名まで", min: OFFER_PARTY_MAX_MIN, max: OFFER_PARTY_MAX_MAX };
  // `until_in_past` は入れた時刻を、`until_over_window` は最長の時刻を文に使う（domain/texts）。
  const ctxUntil: RefusalContext = { field: "何時まで", input: until, latest: latestUntil };

  /** 1操作ぶんを送る。通ったらその欄を空に戻し、ホームを取り直す。終わっていてもホームを取り直す（基準 19.12）。 */
  const sendOne = async (change: Change, body: Record<string, unknown>, reset: () => void): Promise<Outcome> => {
    const outcome = await change.send(body);
    if (outcome === "ok") reset();
    return outcome;
  };
  const afterOne = (outcome: Outcome) => {
    if (outcome !== "refused") onChanged();
  };

  /** 目に出さない1操作ずつの送信（キーボード・読み上げ・受け入れ検査）。 */
  const submitAdd = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendOne(add, { count: numberToSend(addCount) }, () => setAddCount("")).then(afterOne);
  };
  const submitReduce = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendOne(reduce, { count: numberToSend(reduceCount) }, () => setReduceCount("")).then(afterOne);
  };
  const submitPartyMax = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendOne(partyMaxChange, { partyMax: numberToSend(partyMax) }, () => setPartyMax("")).then(afterOne);
  };
  const submitUntil = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void sendOne(untilChange, { until }, () => setUntil("")).then(afterOne);
  };

  /**
   * 「更新する」——変えたものだけを、既存の4つの入口へ**順に**送る（新しい入口は作らない）。
   * 断られた操作の文はその操作の欄の下に残り、通った操作の欄は空に戻る。
   * 全部済んでから1回だけホームを取り直す。途中でオファーが終わっていたら、そこで止めて取り直す。
   */
  const applyAll = async () => {
    const steps: Array<() => Promise<Outcome>> = [];
    if (addCount !== "") steps.push(() => sendOne(add, { count: numberToSend(addCount) }, () => setAddCount("")));
    if (reduceCount !== "") steps.push(() => sendOne(reduce, { count: numberToSend(reduceCount) }, () => setReduceCount("")));
    if (partyChanged) steps.push(() => sendOne(partyMaxChange, { partyMax: numberToSend(partyMax) }, () => setPartyMax("")));
    if (untilChanged) steps.push(() => sendOne(untilChange, { until }, () => setUntil("")));
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

  const pendingCount = [capacityChanged, partyChanged, untilChanged].filter(Boolean).length;

  return (
    <section className="store-card store-card--accent store-offer" data-testid="offer-card">
      {/* いちばん上＝「向かっている客」の直下。止める操作を探させない（本人の指摘①） */}
      <div className="store-card__head store-offer__head">
        <div className="store-offer__title">
          <h2>公開中のオファー</h2>
          <span className="store-badge">
            <span className="store-badge__dot" />
            配信中
          </span>
        </div>
        <div className="store-offer__stop">
          <button
            type="button"
            className="store-btn store-btn--danger"
            data-testid="btn-stop"
            onClick={() => {
              void stop.send({}).then(afterOne);
            }}
          >
            ■ 公開を止める
          </button>
        </div>
      </div>
      <FormMessage failure={stop.failure} />

      <div className="store-two-col">
        <div className="store-col">
          <OfferFacts
            offer={offer}
            nextCapacity={capacityChanged ? capacityTarget : null}
            nextPartyMax={partyChanged ? partyMax : null}
            nextUntil={untilChanged ? until : null}
          />
          <OfferCoupons coupons={offer.coupons} />
        </div>

        <div className="store-col store-col--aside">
          <OfferTrend capacity={offer.capacity} remaining={offer.remaining} points={trend} />
        </div>
      </div>

      {/* 数を変える札——回して決めて、「更新する」で一括（本人の指摘②） */}
      <div className="store-tune">
        <div className="store-tune__head">
          <h3>数を変える</h3>
          <p className="store-note">回して決めて、最後に「更新する」で一度に送ります</p>
        </div>

        <div className="store-tune__dials">
          <div className={capacityChanged ? "store-tune__dial store-tune__dial--changed" : "store-tune__dial"}>
            <p className="store-label">配信数</p>
            <Wheel min={OFFER_CAPACITY_MIN} max={OFFER_CAPACITY_MAX} value={String(capacityTarget)} onChange={dialCapacity} unit="組" size="lg" />
            <NextValue now={String(offer.capacity)} next={capacityChanged ? String(capacityTarget) : null} unit=" 組" />
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
              />
              <FieldMessage name="count" failure={add.failure} ctx={ctxCount("追加で出す組数")} />
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
              />
              <FieldMessage name="count" failure={reduce.failure} ctx={ctxCount("減らす組数")} />
              <FormMessage failure={reduce.failure} fieldNames={["count"]} ctx={ctxCount("減らす組数")} />
            </form>
          </div>

          <div className={partyChanged ? "store-tune__dial store-tune__dial--changed" : "store-tune__dial"}>
            <p className="store-label">何名まで</p>
            <Wheel min={OFFER_PARTY_MAX_MIN} max={OFFER_PARTY_MAX_MAX} value={partyTarget} onChange={dialPartyMax} unit="名" size="lg" />
            <NextValue now={String(offer.partyMax)} next={partyChanged ? partyMax : null} unit=" 名" />
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
              />
              <FieldMessage name="partyMax" failure={partyMaxChange.failure} ctx={ctxParty} />
              <FormMessage failure={partyMaxChange.failure} fieldNames={["partyMax"]} ctx={ctxParty} />
            </form>
          </div>

          {/* 「何時まで」——時刻は回すより打つ方が早いので欄のまま。欄の横に**公開した時刻と最長の時刻**を
              出す（基準 19.11 の後半）——時分だけの入力では、公開した時刻より前の時分が翌日と読まれる
              ことを見分けられないので、範囲を目で確かめられるようにする。 */}
          <form
            className={untilChanged ? "store-tune__form store-tune__until store-tune__dial--changed" : "store-tune__form store-tune__until"}
            data-testid="form-until"
            noValidate
            onSubmit={submitUntil}
          >
            <label className="store-label" htmlFor="offer-until">
              何時まで
            </label>
            <input
              id="offer-until"
              data-testid="field-until"
              className="store-tune__time"
              type="time"
              value={until}
              onChange={(event) => {
                setUntil(event.target.value);
                setNothingToSend(false);
              }}
            />
            <NextValue now={nowUntil} next={untilChanged ? until : null} unit="" />
            <p className="store-note">
              {publishedAt} 公開・最長 {latestUntil} まで
            </p>
            <button type="submit" className="store-sr-only" data-testid="btn-until">
              何時までを変える
            </button>
            <FieldMessage name="until" failure={untilChange.failure} ctx={ctxUntil} />
            <FormMessage failure={untilChange.failure} fieldNames={["until"]} ctx={ctxUntil} />
          </form>
        </div>

        <div className="store-tune__foot">
          <p className={pendingCount === 0 ? "store-note" : "store-tune__pending"}>
            {pendingCount === 0 ? "変えたところはありません" : `${pendingCount} 項目を変えます`}
          </p>
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
        {nothingToSend ? <p className="store-note">ダイヤルを回すか、時刻を入れてから押してください。</p> : null}
      </div>
    </section>
  );
};

export default OfferPanel;
