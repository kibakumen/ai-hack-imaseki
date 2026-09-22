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
//     ⚠️ 畳むのは見た目だけ——欄は DOM に残したまま隠す。前回の値が入っているときと、
//     入口が「何時まで」を断ったときは開いた状態にする（隠れた欄に文が付くのを避ける）
//   - クーポンは**チェックの付いたカードを横に並べる**

import { useState, type FormEvent } from "react";
import { apiCall, isFailure, type ApiFailure } from "../../lib/client/api";
import { OFFER_CAPACITY_MAX, OFFER_CAPACITY_MIN, OFFER_PARTY_MAX_MAX, OFFER_PARTY_MAX_MIN } from "../../lib/schemas/limits";
import { FieldMessage, FormMessage } from "../ui/InputRefusal";
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
 * 「何時まで」の欄と、その開け閉め。
 *
 * ⚠️ **ここは本人の指摘の当て方を1つ変えてある**（2026-09-22・要報告）。
 * 指摘は「終了時刻は初めは畳んでおいて、ボタンで出す」だが、それは速成版の作り——速成版の
 * 終了時刻は**入れなくてよい**（未設定ならずっと受け付ける）。v2 の「何時まで」は**入れないと
 * 公開できない**（`schemas/offer.ts` の `until` は必須・要件17の基準 17.6）。そのまま畳むと、
 * 初めて公開する店は**必ず1回断られてから**畳まれた欄に気づくことになる。
 * そこで「畳むのは前回の値が入っている時だけ」にした——公開し直す店（基準 17.18）は触らずに
 * 済み、初めての店には初めから見えている。
 *
 * ⚠️ 畳んでいる間も**欄は DOM に残す**（CSS で隠すだけ）。今の値は横に出す——隠れた値のまま
 * 送らせない。
 */
const UntilField = ({
  value,
  open,
  onToggle,
  onChange,
}: {
  value: string;
  open: boolean;
  onToggle: () => void;
  onChange: (next: string) => void;
}) => (
  <>
    <div className="store-row">
      <span className="store-note">{open ? "何時まで受け付けるか（公開から12時間以内）" : `何時まで ${value === "" ? "未入力" : value}`}</span>
      <button type="button" className="store-btn store-btn--quiet" onClick={onToggle}>
        {open ? "隠す" : "終了の時刻を変える"}
      </button>
    </div>
    <div className={open ? "store-collapse" : "store-collapse store-collapse--closed"}>
      <div className="store-field">
        <label htmlFor="publish-until">何時まで</label>
        <input id="publish-until" data-testid="field-until" type="time" value={value} onChange={(event) => onChange(event.target.value)} />
      </div>
    </div>
  </>
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
    <div className="store-coupons">
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
  // ⚠️ **前回の値が入っている時だけ畳む**（本人の指摘への当て方を1つ変えた・下の注を参照）
  const [untilOpen, setUntilOpen] = useState(prefill.until === null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  const toggleCoupon = (id: string) => {
    setCouponIds((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = await apiCall("POST", "/api/store/offers", {
      couponIds,
      capacity: toNumberOrNull(capacity),
      partyMax: toNumberOrNull(partyMax),
      until,
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
        />
      </div>
      <FieldMessage name="capacity" failure={failure} ctx={{ field: CAPACITY_LABEL, min: OFFER_CAPACITY_MIN, max: OFFER_CAPACITY_MAX }} />
      <FieldMessage name="partyMax" failure={failure} ctx={{ field: PARTY_MAX_LABEL, min: OFFER_PARTY_MAX_MIN, max: OFFER_PARTY_MAX_MAX }} />

      <UntilField value={until} open={untilOpen} onToggle={() => setUntilOpen((open) => !open)} onChange={setUntil} />
      <FieldMessage name="until" failure={failure} ctx={{ field: "何時まで" }} />

      <CouponChoices coupons={coupons} selected={couponIds} onToggle={toggleCoupon} />

      <button type="submit" className="store-btn store-btn--primary" data-testid="btn-publish">
        公開する
      </button>
      <FormMessage failure={failure} fieldNames={FIELD_NAMES} links={PROFILE_LINKS} />
    </form>
  );
};

export default PublishForm;
