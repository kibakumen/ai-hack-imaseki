"use client";

// 公開中のオファーのカード（要件17の基準 17.22・17.12、要件18の基準 18.15、要件19の全部）。
// 出すのは5項目——配信数（＝募集する組数）・残り・何名まで・何時まで・見せているクーポン——と、
// 公開したままできる4つの操作、そして離して置いた「公開を止める」。
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
// 見た目は 2026-09-21 の本人の指摘を入れた（速成版 sprint/app/store が基準）:
//   **左＝今の中身と4つの操作／右＝今日の動き（折れ線）**の2カラム。狭い画面では縦に積む。

import { useState, type FormEvent } from "react";
import { apiCall, isFailure, type ApiFailure } from "../../lib/client/api";
import { OFFER_CAPACITY_MAX, OFFER_CAPACITY_MIN, OFFER_PARTY_MAX_MAX, OFFER_PARTY_MAX_MIN } from "../../lib/schemas/limits";
import { FieldMessage, FormMessage, type RefusalContext } from "../ui/InputRefusal";
import { OfferTrend, type TrendPoint } from "./OfferTrend";
import { timeInJst } from "./jstTime";

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

/** 空欄は項目を載せない（入口が「入れてください」と答える）。数にならない文字はそのまま載せる。 */
const numberToSend = (text: string): number | string | undefined => {
  if (text.trim() === "") return undefined;
  const value = Number(text);
  return Number.isNaN(value) ? text : value;
};

/**
 * 1つの操作ぶんの送信と、その操作の断り。**操作ごとに別に持つ**ので、ある操作の断りが
 * ほかの操作の欄に出ることはない（要件19の基準 19.2・19.5・19.9）。
 */
const useOfferChange = (action: OfferAction, onChanged: () => void) => {
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  const submit = async (body: Record<string, unknown>): Promise<void> => {
    const result = await apiCall("POST", `/api/store/offers/current/${action}`, body);
    if (!isFailure(result)) {
      setFailure(null);
      onChanged();
      return;
    }
    // 画面は移らず、入れた内容もそのまま（設計書「入力の誤りの出し方」の規則3）。
    setFailure(result);
    // 終わったオファーへの変更だけはホームを取り直す（基準 19.12）。カードが公開のフォームに変わる。
    if (result.error?.kind === "offer_ended") onChanged();
  };

  return { failure, submit };
};

/** 数を入れて押す2つの操作（「追加で出す」基準 19.1・「残りの募集を減らす」基準 19.4）。 */
const CountForm = ({
  action,
  label,
  button,
  remaining,
  onChanged,
}: {
  action: "add" | "reduce";
  label: string;
  button: string;
  /** 断りの文に入れる今の残り（`over_capacity`・`over_remaining` の雛形が使う） */
  remaining: number;
  onChanged: () => void;
}) => {
  const { failure, submit } = useOfferChange(action, onChanged);
  const [count, setCount] = useState("");
  const ctx: RefusalContext = { field: label, min: OFFER_CAPACITY_MIN, max: OFFER_CAPACITY_MAX, remaining };

  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit({ count: numberToSend(count) });
  };

  return (
    <form className="store-change" data-testid={`form-${action}`} noValidate onSubmit={send}>
      <label htmlFor={`offer-${action}-count`}>{label}</label>
      <div className="store-change__line">
        <input
          id={`offer-${action}-count`}
          data-testid="field-count"
          type="number"
          inputMode="numeric"
          min={OFFER_CAPACITY_MIN}
          max={OFFER_CAPACITY_MAX}
          value={count}
          onChange={(event) => setCount(event.target.value)}
        />
        <button type="submit" className="store-btn store-btn--quiet" data-testid={`btn-${action}`}>
          {button}
        </button>
      </div>
      <FieldMessage name="count" failure={failure} ctx={ctx} />
      <FormMessage failure={failure} fieldNames={["count"]} ctx={ctx} />
    </form>
  );
};

/** 「何名まで」を上げ下げする（要件19の基準 19.6）。 */
const PartyMaxForm = ({ onChanged }: { onChanged: () => void }) => {
  const { failure, submit } = useOfferChange("party-max", onChanged);
  const [partyMax, setPartyMax] = useState("");
  const ctx: RefusalContext = { field: "何名まで", min: OFFER_PARTY_MAX_MIN, max: OFFER_PARTY_MAX_MAX };

  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit({ partyMax: numberToSend(partyMax) });
  };

  return (
    <form className="store-change" data-testid="form-party-max" noValidate onSubmit={send}>
      <label htmlFor="offer-party-max">何名までを変える</label>
      <div className="store-change__line">
        <input
          id="offer-party-max"
          data-testid="field-partyMax"
          type="number"
          inputMode="numeric"
          min={OFFER_PARTY_MAX_MIN}
          max={OFFER_PARTY_MAX_MAX}
          value={partyMax}
          onChange={(event) => setPartyMax(event.target.value)}
        />
        <button type="submit" className="store-btn store-btn--quiet" data-testid="btn-party-max">
          変える
        </button>
      </div>
      <FieldMessage name="partyMax" failure={failure} ctx={ctx} />
      <FormMessage failure={failure} fieldNames={["partyMax"]} ctx={ctx} />
    </form>
  );
};

/**
 * 「何時まで」を延ばす・早める（要件19の基準 19.8・19.9・19.13）。
 * 欄の横に**公開した時刻と最長の時刻**を出す（基準 19.11 の後半）——時分だけの入力では、公開した
 * 時刻より前の時分が翌日と読まれることを見分けられないので、範囲を目で確かめられるようにする。
 */
const UntilForm = ({ publishedAt, latestUntil, onChanged }: { publishedAt: string; latestUntil: string; onChanged: () => void }) => {
  const { failure, submit } = useOfferChange("until", onChanged);
  const [until, setUntil] = useState("");
  // `until_in_past` は入れた時刻を、`until_over_window` は最長の時刻を文に使う（domain/texts）。
  const ctx: RefusalContext = { field: "何時まで", input: until, latest: latestUntil };

  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void submit({ until });
  };

  return (
    <form className="store-change" data-testid="form-until" noValidate onSubmit={send}>
      <label htmlFor="offer-until">何時までを変える</label>
      <div className="store-change__line">
        <input id="offer-until" data-testid="field-until" type="time" value={until} onChange={(event) => setUntil(event.target.value)} />
        <button type="submit" className="store-btn store-btn--quiet" data-testid="btn-until">
          変える
        </button>
      </div>
      <p className="store-note">
        {publishedAt} 公開・最長 {latestUntil} まで
      </p>
      <FieldMessage name="until" failure={failure} ctx={ctx} />
      <FormMessage failure={failure} fieldNames={["until"]} ctx={ctx} />
    </form>
  );
};

/**
 * 今の中身の4項目（配信数・残り・何名まで・何時まで）。5つ目の「見せているクーポン」は
 * 数ではないので下の `OfferCoupons` が出す（基準 17.22 の5項目）。
 * ⚠️ 残りは `offer-remaining` の名前で出す——店が打つ欄は置かない（基準 18.15）。
 */
const OfferFacts = ({ offer }: { offer: OfferPanelOffer }) => (
  <dl className="store-facts">
    <div className="store-fact">
      <dt className="store-fact__label">配信数</dt>
      <dd className="store-fact__value">{offer.capacity} 組</dd>
    </div>
    <div className="store-fact" data-testid="offer-remaining">
      <dt className="store-fact__label">残り</dt>
      <dd className="store-fact__value">{offer.remaining} 組</dd>
    </div>
    <div className="store-fact">
      <dt className="store-fact__label">何名まで</dt>
      <dd className="store-fact__value">{offer.partyMax} 名</dd>
    </div>
    <div className="store-fact">
      <dt className="store-fact__label">何時まで</dt>
      <dd className="store-fact__value">{timeInJst(offer.untilAt)}</dd>
    </div>
  </dl>
);

/** 見せているクーポン（読むだけ）。⚠️ チェックを変える操作は置かない（基準 19.11）。 */
const OfferCoupons = ({ coupons }: { coupons: OfferPanelOffer["coupons"] }) => (
  <div>
    <p className="store-note">見せているクーポン</p>
    {coupons.length === 0 ? (
      <p className="store-empty">クーポンを見せないオファーとして公開しています。</p>
    ) : (
      <div className="store-chips">
        {coupons.map((coupon) => (
          <span className="store-chip" key={coupon.id}>
            <span className="store-chip__text">
              <span>{coupon.name}</span>
              {coupon.note === "" ? null : <span className="store-chip__note">{coupon.note}</span>}
            </span>
          </span>
        ))}
      </div>
    )}
  </div>
);

export const OfferPanel = ({ offer, trend, onChanged }: Props) => {
  const { failure, submit } = useOfferChange("stop", onChanged);

  return (
    <section className="store-card store-card--accent" data-testid="offer-card">
      <div className="store-card__head">
        <h2>公開中のオファー</h2>
        <span className="store-badge">
          <span className="store-badge__dot" />
          配信中
        </span>
      </div>

      <div className="store-two-col">
        <div className="store-col">
          <OfferFacts offer={offer} />
          <OfferCoupons coupons={offer.coupons} />

          <CountForm action="add" label="追加で出す組数" button="追加で出す" remaining={offer.remaining} onChanged={onChanged} />
          <CountForm action="reduce" label="減らす組数" button="残りを減らす" remaining={offer.remaining} onChanged={onChanged} />
          <PartyMaxForm onChanged={onChanged} />
          <UntilForm publishedAt={timeInJst(offer.publishedAt)} latestUntil={timeInJst(offer.latestUntil)} onChanged={onChanged} />
        </div>

        <div className="store-col store-col--aside">
          <OfferTrend capacity={offer.capacity} remaining={offer.remaining} points={trend} />
        </div>
      </div>

      <div>
        <button
          type="button"
          className="store-btn store-btn--danger"
          data-testid="btn-stop"
          onClick={() => {
            void submit({});
          }}
        >
          公開を止める（今すぐ）
        </button>
        <FormMessage failure={failure} />
      </div>
    </section>
  );
};

export default OfferPanel;
