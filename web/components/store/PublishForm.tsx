"use client";

// オファーを公開するフォーム（要件17の基準 17.1〜17.8・17.17〜17.21・17.23）。
// 受付時間の始まりをずらす欄と、曜日の繰り返しの欄は置かない（基準 17.7・17.8）。
// 送る前に自分では検査せず、入口が返した断りを InputRefusal に描かせる
// （設計書「入力の誤りの出し方」の規則5）。断られてもフォームのまま、入れた内容は消さない。
//
// 見た目は 2026-09-21 の本人の指摘を入れた（速成版 sprint/app/store が基準）:
//   - 「募集する組数」は**配信数**と呼ぶ
//   - 配信数と何名までは**ダイヤル**で選ぶ（打った文字は WheelPicker の裏の欄がそのまま持つ）
//   - **終了時刻は初めは畳んでおく**（多くの店は「ずっと受け付ける」ので、毎回は要らない）。
//     2026-09-25 監査の指摘 店-05 の案A で「何時まで」を**入れなくても公開できる**ようにした（入れなければ公開から
//     12時間で自動で終わる）ので、本人の指摘どおり**いつも畳んでおく**「終了タイマー」になった。
//     ⚠️ 畳むのは見た目だけ——欄は DOM に残したまま隠す。入口が「何時まで」を断ったときは開く
//   - クーポンは**チェックの付いたカードを横に並べる**

import { useState, type FormEvent } from "react";
import { callApi, isFailure, type ApiFailure } from "../../lib/client/api";
import { OFFER_CAPACITY_MAX, OFFER_CAPACITY_MIN, OFFER_PARTY_MAX_MAX, OFFER_PARTY_MAX_MIN } from "../../lib/schemas/limits";
import { FieldMessage, FormMessage, fieldAria } from "../ui/InputRefusal";
import { WheelPicker } from "./WheelPicker";

export type PublishFormCoupon = { id: string; name: string; note: string };
export type PublishFormPrefill = { couponIds: string[]; capacity: number | null; partyMax: number | null; until: string | null };

type Props = {
  coupons: PublishFormCoupon[];
  prefill: PublishFormPrefill;
  /** 公開できたら、店のホームを取り直してカードに切り替える */
  onPublished: () => void;
};

const FIELD_NAMES = ["capacity", "partyMax", "until"];
/** 足りない店の情報で断られたときの行き先（基準 17.11 の案内） */
const PROFILE_LINKS = { profile_incomplete: { href: "/store/profile", label: "店の情報を開く" } };
/** 「何時まで」に関わる断りの語。返ってきたら畳んだ欄を開く */
const UNTIL_KINDS = ["until_in_past", "until_over_window"];
const CAPACITY_LABEL = "配信数";
const PARTY_MAX_LABEL = "何名まで";

const numberText = (value: number | null): string => (value === null ? "" : String(value));
const toNumberOrNull = (text: string): number | null => (text.trim() === "" ? null : Number(text));

/** 「何時まで」に帰せる断りが返ったか（畳んである欄に文が付くのを避けるために開く） */
const untilRefused = (failure: ApiFailure | null): boolean =>
  (failure?.error?.fields ?? []).some((f) => f.name === "until") || UNTIL_KINDS.includes(failure?.error?.kind ?? "");

/**
 * 終了タイマー（「何時まで」）の欄と、その開け閉め（2026-09-25 監査の指摘 店-05 の案A）。
 *
 * 本人の指摘は「公開終了時間は未入力でも公開可。忙しくて忘れそうなときのために、終了タイマーとして入れられる
 * 温度感」。そこで**いつも畳んでおき**、入れていなければ「公開から12時間で自動で終わる」と書き、入れていれば
 * その時刻を横に出す（隠れた値のまま送らせない）。
 *
 * ⚠️ 畳んでいる間も**欄は DOM に残す**（CSS で隠すだけ・受け入れ検査が欄に打つ）。
 */
const UntilField = ({
  value,
  open,
  onToggle,
  onChange,
  failure,
}: {
  value: string;
  open: boolean;
  onToggle: () => void;
  onChange: (next: string) => void;
  /** 断りが返っていれば、欄が文を指す（横断-05） */
  failure: ApiFailure | null;
}) => (
  <div className="store-timer">
    <div className="store-row">
      <span className="store-note">{value === "" ? "終了タイマーなし（公開から12時間で自動で終わります）" : `終了タイマー ${value} に終わります`}</span>
      <button type="button" className="store-btn store-btn--quiet" aria-expanded={open} aria-controls="publish-until-box" onClick={onToggle}>
        {open ? "終了タイマーを閉じる" : value === "" ? "終了タイマーを設定" : "終了タイマーを変える"}
      </button>
    </div>
    <div id="publish-until-box" className={open ? "store-collapse" : "store-collapse store-collapse--closed"}>
      <div className="store-field">
        <label htmlFor="publish-until">何時に終わるか（公開から12時間以内）</label>
        <div className="store-inline">
          <input
            id="publish-until"
            data-testid="field-until"
            type="time"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            {...fieldAria("until", failure, "publish-until")}
          />
          {value === "" ? null : (
            <button type="button" className="store-btn store-btn--quiet" onClick={() => onChange("")}>
              タイマーを外す
            </button>
          )}
        </div>
      </div>
    </div>
  </div>
);

/**
 * 見せるクーポンの選び方——**チェックボックスつきの札**（2026-09-22 の本人の指摘「クーポンカードは
 * チェックボックスカードにして選択状態がわかりやすく」）。選ばれた札は縁と地が橙に変わり、左の四角に
 * チェックが入る。客の画面のクーポンの札（`me.css` の `.offer-coupon`・点線の縁）と同じ語彙。
 * ⚠️ 本物の `<input type="checkbox">` は DOM に残す（受け入れ検査が `coupon-<id>` で押す・
 *    読み上げとキーボードもこちらに答える）。目に見えるチェックは CSS が描く。
 */
const CouponChoices = ({
  coupons,
  selected,
  onToggle,
}: {
  coupons: PublishFormCoupon[];
  selected: string[];
  onToggle: (id: string) => void;
}) => (
  <fieldset className="store-field store-coupon-set" data-testid="coupon-list">
    <legend>見せるクーポン（押して選ぶ・0個でもよい）</legend>
    {coupons.length === 0 ? <p className="store-empty">クーポンはまだありません。</p> : null}
    <div className="store-coupons store-coupons--wrap">
      {coupons.map((coupon) => {
        const on = selected.includes(coupon.id);
        return (
          <label className={on ? "store-coupon store-coupon--on" : "store-coupon"} key={coupon.id} htmlFor={`publish-coupon-${coupon.id}`}>
            <input
              id={`publish-coupon-${coupon.id}`}
              data-testid={`coupon-${coupon.id}`}
              className="store-coupon__input"
              type="checkbox"
              checked={on}
              onChange={() => onToggle(coupon.id)}
            />
            <span className="store-coupon__check" aria-hidden="true">
              {on ? "✓" : ""}
            </span>
            <span className="store-coupon__body">
              <span className="store-coupon__name">{coupon.name}</span>
              {coupon.note === "" ? null : <span className="store-coupon__note">{coupon.note}</span>}
            </span>
          </label>
        );
      })}
    </div>
    {/* 入れ忘れに気づかせる表示（要件17の基準 17.23）。チェックが0個の間だけ出す */}
    {selected.length === 0 ? <p className="store-note">クーポンを見せないオファーとして公開されます。</p> : null}
  </fieldset>
);

export const PublishForm = ({ coupons, prefill, onPublished }: Props) => {
  const [couponIds, setCouponIds] = useState<string[]>(prefill.couponIds);
  const [capacity, setCapacity] = useState(numberText(prefill.capacity));
  const [partyMax, setPartyMax] = useState(numberText(prefill.partyMax));
  const [until, setUntil] = useState(prefill.until ?? "");
  // 終了タイマーはいつも畳んでおく（入れなくても公開できる・店-05）。断られたら開く
  const [untilOpen, setUntilOpen] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  const toggleCoupon = (id: string) => {
    setCouponIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = await callApi("POST /api/store/offers", {
      body: {
        couponIds,
        capacity: toNumberOrNull(capacity),
        partyMax: toNumberOrNull(partyMax),
        // 空欄は載せない＝終了タイマーなし（公開から12時間で自動で終わる・店-05）
        until: until === "" ? undefined : until,
      },
    });
    if (isFailure(result)) {
      // 画面は移らず、入れた内容もそのまま（設計書「入力の誤りの出し方」の規則3）。
      setFailure(result);
      if (untilRefused(result)) setUntilOpen(true);
      return;
    }
    setFailure(null);
    onPublished();
  };

  return (
    <form
      className="store-card store-card--accent"
      data-testid="form-publish"
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <div className="store-card__head">
        <h2>オファーを公開する</h2>
        <span className="store-badge store-badge--off">停止中</span>
      </div>

      <div className="store-dials">
        <WheelPicker
          testId="field-capacity"
          inputId="publish-capacity"
          label={CAPACITY_LABEL}
          unit="組"
          min={OFFER_CAPACITY_MIN}
          max={OFFER_CAPACITY_MAX}
          value={capacity}
          onChange={setCapacity}
          aria={fieldAria("capacity", failure, "publish-capacity")}
        />
        <WheelPicker
          testId="field-partyMax"
          inputId="publish-party-max"
          label={PARTY_MAX_LABEL}
          unit="名"
          min={OFFER_PARTY_MAX_MIN}
          max={OFFER_PARTY_MAX_MAX}
          value={partyMax}
          onChange={setPartyMax}
          aria={fieldAria("partyMax", failure, "publish-party-max")}
        />
      </div>
      <FieldMessage inputId="publish-capacity" name="capacity" failure={failure} ctx={{ field: CAPACITY_LABEL, min: OFFER_CAPACITY_MIN, max: OFFER_CAPACITY_MAX }} />
      <FieldMessage inputId="publish-party-max" name="partyMax" failure={failure} ctx={{ field: PARTY_MAX_LABEL, min: OFFER_PARTY_MAX_MIN, max: OFFER_PARTY_MAX_MAX }} />

      <UntilField value={until} open={untilOpen} onToggle={() => setUntilOpen((open) => !open)} onChange={setUntil} failure={failure} />
      <FieldMessage inputId="publish-until" name="until" failure={failure} ctx={{ field: "何時まで" }} />

      <CouponChoices coupons={coupons} selected={couponIds} onToggle={toggleCoupon} />

      <button type="submit" className="store-btn store-btn--primary" data-testid="btn-publish">
        公開する
      </button>
      <FormMessage failure={failure} fieldNames={FIELD_NAMES} links={PROFILE_LINKS} />
    </form>
  );
};

export default PublishForm;
