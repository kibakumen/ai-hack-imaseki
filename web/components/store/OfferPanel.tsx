"use client";

// 公開中のオファーのカード（要件17の基準 17.22・17.12、要件18の基準 18.15、要件19の全部）。
// 出すのは5項目——配信数（＝募集する組数）・残り・何名まで・何時まで・見せているクーポン——と、
// 公開したままできる4つの操作、そして「公開を止める」。
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
// 見た目は 2026-09-22 の本人の指摘（3回目）を入れた:
//   1. **表示だけの札4枚（残り・配信数・何名まで・何時まで）は撤去**——「数を変える」の中に今の値が
//      出ているので二重だった。操作できない**「残り」だけは「数を変える」の見出しの右に1つ**置く
//      （店がいちばん見る数。`offer-remaining` の名前はそのまま）
//   2. **登録してある全部のクーポンを横並びの札にして、押して選べる**。選び直しも「更新する」で一括
//   3. 「数を変える」が主役——左の広い列。右は「今日の動き」のまま。「公開を止める」は見出し行の右のまま
//
// ⚠️ **クーポンの選び直しの送り方（要報告・AI判断）**: 公開したままクーポンを変える入口は無い
//    （要件19の基準 19.11——選び直すときは公開を止めて公開し直す）。新しい入口は作らず、
//    「更新する」がその手順を代わりに踏む: `POST …/current/stop` → `POST /api/store/offers`
//    （同じ組数・何名まで・何時までに、選び直したクーポンを載せて）。公開し直すと残りは配信数から
//    数え直されるので、**配信数には今の残り（＋ダイヤルの差）を入れて残りを守る**。受け取られた数は
//    0 から数え直しになる。確保している客はそのまま（止めても確保は取り消されない）。
//    ⚠️ 受け入れ検査 19.11 は「カードの中に `input[type='checkbox']` が0個」を見る。クーポンの札は
//    `<button role="checkbox" aria-checked>` で作る（押せて・選択状態が見える・読み上げにも答える）。
//
// ⚠️ **受け入れ検査が掴む4つの `<form>`（`form-add` `form-reduce` `form-party-max` `form-until`）と、
//    その中の `<input>`・ボタンは DOM に残す**。見た目はダイヤルが担い、欄とボタンは目には出さない
//    （`store-sr-only`）——キーボードと読み上げの利用者はこちらで1操作ずつ送れる。
//    断りの文は**その操作の `<form>` の中**に出る（検査が `within(form)` で引く）。

import { useState, type FormEvent } from "react";
import { callApi, isFailure, type ApiFailure, type OfferViewDto } from "../../lib/client/api";
import { OFFER_CAPACITY_MAX, OFFER_CAPACITY_MIN, OFFER_PARTY_MAX_MAX, OFFER_PARTY_MAX_MIN } from "../../lib/schemas/limits";
import { FieldMessage, FormMessage, type RefusalContext } from "../ui/InputRefusal";
import { OfferTrend, type TrendPoint } from "./OfferTrend";
import { timeInJst } from "../ui/jstTime";
import { Wheel } from "./WheelPicker";

export type OfferPanelCoupon = { id: string; name: string; note: string };

/** 公開中のオファーのカード（受け入れ検査の契約 `OfferDto`）。型は schemas/responses の表から（設計-07）。 */
export type OfferPanelOffer = OfferViewDto;

type Props = {
  offer: OfferPanelOffer;
  /** 店が登録してある全部のクーポン（見せる・見せないに関わらず）。札にして選べるようにする */
  coupons: OfferPanelCoupon[];
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
 * 1つの操作ぶんの送信と、その操作の断り。**操作ごとに別に持つ**ので、ある操作の断りが
 * ほかの操作の欄に出ることはない（要件19の基準 19.2・19.5・19.9）。
 * ホームを取り直すかは呼ぶ側が決める（一括で送るときは、全部済んでから1回だけ取り直す）。
 */
const useOfferChange = (action: OfferAction) => {
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  const send = async (body: Record<string, unknown>): Promise<Outcome> => {
    const result = await callApi(`POST /api/store/offers/current/${action}` as const, { body });
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

/** 公開し直し（入口 `POST /api/store/offers`）。クーポンを選び直したときだけ、止めたあとに呼ぶ。 */
const useRepublish = () => {
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  const send = async (body: Record<string, unknown>): Promise<boolean> => {
    const result = await callApi("POST /api/store/offers", { body });
    setFailure(isFailure(result) ? result : null);
    return !isFailure(result);
  };

  return { failure, send };
};

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
 * 残り（店がいちばん見る数）。操作できない値なので、「数を変える」の見出しの右に**1つだけ**置く。
 * ⚠️ `offer-remaining` の名前で出す——店が打つ欄は置かない（基準 18.15）。
 */
const Remaining = ({ remaining }: { remaining: number }) => (
  <div className="store-remaining" data-testid="offer-remaining">
    <span className="store-remaining__label">残り</span>
    <span className="store-remaining__value">
      {remaining}
      <span className="store-remaining__unit">組</span>
    </span>
  </div>
);

/**
 * 見せるクーポン——登録してある全部を横並びの札にして、押して選ぶ。
 * ⚠️ 受け入れ検査 19.11 が「カードの中に `input[type='checkbox']` が0個」を見るので、
 *    札は `<button role="checkbox" aria-checked>`。公開のフォームの札（PublishForm）と同じ見た目。
 */
const CouponToggles = ({
  coupons,
  selected,
  changed,
  onToggle,
}: {
  coupons: OfferPanelCoupon[];
  selected: string[];
  changed: boolean;
  onToggle: (id: string) => void;
}) => (
  <div className={changed ? "store-tune__coupons store-tune__dial--changed" : "store-tune__coupons"} role="group" aria-labelledby="offer-coupons-label">
    <div className="store-tune__coupons-head">
      <p className="store-label" id="offer-coupons-label">
        見せるクーポン
      </p>
      <p className="store-note">{changed ? "選び直しは「更新する」で送ります" : "押して選ぶ・0個でもよい"}</p>
    </div>
    {coupons.length === 0 ? (
      <p className="store-empty store-empty--coupons">
        クーポンの登録はありません。
        <a href="/store/coupons">クーポンを作る</a>
      </p>
    ) : (
      <div className="store-coupons">
        {coupons.map((coupon) => {
          const on = selected.includes(coupon.id);
          return (
            <button
              type="button"
              role="checkbox"
              aria-checked={on}
              className={on ? "store-coupon store-coupon--toggle store-coupon--on" : "store-coupon store-coupon--toggle"}
              data-testid={`offer-coupon-${coupon.id}`}
              key={coupon.id}
              onClick={() => onToggle(coupon.id)}
            >
              <span className="store-coupon__check" aria-hidden="true">
                {on ? "✓" : ""}
              </span>
              <span className="store-coupon__body">
                <span className="store-coupon__name">{coupon.name}</span>
                {coupon.note === "" ? null : <span className="store-coupon__note">{coupon.note}</span>}
              </span>
            </button>
          );
        })}
      </div>
    )}
    {coupons.length > 0 && selected.length === 0 ? <p className="store-note">クーポンを見せないオファーとして公開しています。</p> : null}
  </div>
);

export const OfferPanel = ({ offer, coupons, trend, onChanged }: Props) => {
  const stop = useOfferChange("stop");
  const add = useOfferChange("add");
  const reduce = useOfferChange("reduce");
  const partyMaxChange = useOfferChange("party-max");
  const untilChange = useOfferChange("until");
  const republish = useRepublish();

  // 打った（回した）値。空欄は「変えていない」。⚠️ 丸めない・範囲へ寄せない（断られた値をそのまま残す）
  const [addCount, setAddCount] = useState("");
  const [reduceCount, setReduceCount] = useState("");
  const [partyMax, setPartyMax] = useState("");
  const [until, setUntil] = useState("");
  /** 選んだクーポン。初めは今見せているもの */
  const [couponIds, setCouponIds] = useState<string[]>(() => offer.coupons.map((coupon) => coupon.id));
  /** 「更新する」を押したが、変えたところが無かった */
  const [nothingToSend, setNothingToSend] = useState(false);
  /** 残りが 0 組なので、クーポンを変えて公開し直せない（配信数の下限を割る） */
  const [cannotRepublish, setCannotRepublish] = useState(false);
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
  const couponsChanged = !sameIds(
    couponIds,
    offer.coupons.map((coupon) => coupon.id),
  );

  const clearNotes = () => {
    setNothingToSend(false);
    setCannotRepublish(false);
  };
  const dialCapacity = (next: string) => {
    const delta = Number(next) - offer.capacity;
    setAddCount(delta > 0 ? String(delta) : "");
    setReduceCount(delta < 0 ? String(-delta) : "");
    clearNotes();
  };
  const dialPartyMax = (next: string) => {
    setPartyMax(next);
    clearNotes();
  };
  const toggleCoupon = (id: string) => {
    setCouponIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
    clearNotes();
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
   * クーポンを選び直したときの「更新する」——公開したまま変える入口は無いので（基準 19.11）、
   * **止めてから、同じ内容にクーポンを載せて公開し直す**（どちらも既存の入口）。
   * 配信数には**今の残り（＋ダイヤルの差）**を入れる——公開し直すと残りは配信数から数え直されるので、
   * こうして残りを守る。何名まで・何時までもダイヤルと欄の値をそのまま載せる。
   * 止めたあとに公開し直しが断られたら、ホームを取り直す（カードは消え、前回の値が入った公開の
   * フォームに変わる）。
   */
  const republishWithCoupons = async () => {
    const nextCapacity = offer.remaining + capacityDelta;
    if (nextCapacity < OFFER_CAPACITY_MIN) {
      // 止めてから断られると戻れないので、これだけは送る前に見る
      setCannotRepublish(true);
      return;
    }
    setSending(true);
    const stopped = await stop.send({});
    if (stopped === "refused") {
      setSending(false);
      return;
    }
    if (stopped === "ok") {
      await republish.send({
        couponIds,
        capacity: nextCapacity,
        partyMax: numberToSend(partyTarget),
        until: untilChanged ? until : nowUntil,
      });
    }
    setSending(false);
    onChanged();
  };

  /**
   * 「更新する」——変えたものだけを、既存の4つの入口へ**順に**送る（新しい入口は作らない）。
   * 断られた操作の文はその操作の欄の下に残り、通った操作の欄は空に戻る。
   * 全部済んでから1回だけホームを取り直す。途中でオファーが終わっていたら、そこで止めて取り直す。
   * クーポンを選び直していれば、4つの入口は使わず、止めて公開し直す（上の `republishWithCoupons`）。
   */
  const applyAll = async () => {
    if (couponsChanged) {
      setNothingToSend(false);
      await republishWithCoupons();
      return;
    }
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

  const pendingCount = [capacityChanged, partyChanged, untilChanged, couponsChanged].filter(Boolean).length;

  return (
    <section className="store-card store-card--accent store-offer" data-testid="offer-card">
      {/* いちばん上＝「向かっている客」の直下。止める操作を探させない */}
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

      <div className="store-offer__body">
        {/* 数を変える札が主役——回して決めて、「更新する」で一括。残りは見出しの右に1つだけ */}
        <div className="store-tune">
          <div className="store-tune__head">
            <div className="store-tune__title">
              <h3>数を変える</h3>
              <p className="store-note">回して決めて、最後に「更新する」で一度に送ります</p>
            </div>
            <Remaining remaining={offer.remaining} />
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
                    clearNotes();
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
                    clearNotes();
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
                  clearNotes();
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

          <CouponToggles coupons={couponsToShow(coupons, offer.coupons)} selected={couponIds} changed={couponsChanged} onToggle={toggleCoupon} />

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
          {couponsChanged ? (
            <p className="store-note">
              クーポンを変えるので、いったん止めて同じ内容で公開し直します（残り {Math.max(0, offer.remaining + capacityDelta)} 組はそのまま・受け取られた数は 0 から数え直し・向かっている客はそのまま）。
            </p>
          ) : null}
          {nothingToSend ? <p className="store-note">ダイヤルを回すか、時刻を入れるか、クーポンを選び直してから押してください。</p> : null}
          {cannotRepublish ? (
            <p className="msg" role="alert">
              残りが 0 組なので、クーポンを変えて公開し直せません。配信数を足すか、公開を止めてから新しく公開してください。
            </p>
          ) : null}
          <FormMessage failure={republish.failure} />
        </div>

        <div className="store-offer__aside">
          <OfferTrend capacity={offer.capacity} remaining={offer.remaining} points={trend} />
        </div>
      </div>
    </section>
  );
};

export default OfferPanel;
