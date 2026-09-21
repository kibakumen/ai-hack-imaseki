"use client";

// オファーを公開するフォーム（要件17の基準 17.1〜17.8・17.17〜17.21・17.23）。
// 受付時間の始まりをずらす欄と、曜日の繰り返しの欄は置かない（基準 17.7・17.8）。
// 送る前に自分では検査せず、入口が返した断りを InputRefusal に描かせる
// （設計書「入力の誤りの出し方」の規則5）。断られてもフォームのまま、入れた内容は消さない。

import { useState, type FormEvent } from "react";
import { apiCall, isFailure, type ApiFailure } from "../../lib/client/api";
import { OFFER_CAPACITY_MAX, OFFER_CAPACITY_MIN, OFFER_PARTY_MAX_CHOICES, OFFER_PARTY_MAX_MAX, OFFER_PARTY_MAX_MIN } from "../../lib/schemas/limits";
import { FieldMessage, FormMessage } from "../ui/InputRefusal";

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

const numberText = (value: number | null): string => (value === null ? "" : String(value));
const toNumberOrNull = (text: string): number | null => (text.trim() === "" ? null : Number(text));

export const PublishForm = ({ coupons, prefill, onPublished }: Props) => {
  const [couponIds, setCouponIds] = useState<string[]>(prefill.couponIds);
  const [capacity, setCapacity] = useState(numberText(prefill.capacity));
  const [partyMax, setPartyMax] = useState(numberText(prefill.partyMax));
  const [until, setUntil] = useState(prefill.until ?? "");
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
      return;
    }
    setFailure(null);
    onPublished();
  };

  return (
    <form
      data-testid="form-publish"
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <h2>オファーを公開する</h2>

      <fieldset data-testid="coupon-list">
        <legend>見せるクーポン</legend>
        {coupons.length === 0 ? <p>クーポンはまだありません。</p> : null}
        {coupons.map((coupon) => (
          <label key={coupon.id} htmlFor={`publish-coupon-${coupon.id}`}>
            <input
              id={`publish-coupon-${coupon.id}`}
              data-testid={`coupon-${coupon.id}`}
              type="checkbox"
              checked={couponIds.includes(coupon.id)}
              onChange={() => toggleCoupon(coupon.id)}
            />
            {coupon.name}
          </label>
        ))}
        {couponIds.length === 0 ? <p>クーポンを見せないオファーとして公開されます。</p> : null}
      </fieldset>

      <label htmlFor="publish-capacity">募集する組数</label>
      <input
        id="publish-capacity"
        data-testid="field-capacity"
        type="number"
        inputMode="numeric"
        min={OFFER_CAPACITY_MIN}
        max={OFFER_CAPACITY_MAX}
        value={capacity}
        onChange={(event) => setCapacity(event.target.value)}
      />
      <FieldMessage name="capacity" failure={failure} ctx={{ field: "募集する組数", min: OFFER_CAPACITY_MIN, max: OFFER_CAPACITY_MAX }} />

      <label htmlFor="publish-party-max">何名まで</label>
      <div>
        {OFFER_PARTY_MAX_CHOICES.map((choice) => (
          <button key={choice} type="button" onClick={() => setPartyMax(String(choice))}>
            {choice}名
          </button>
        ))}
      </div>
      <input
        id="publish-party-max"
        data-testid="field-partyMax"
        type="number"
        inputMode="numeric"
        min={OFFER_PARTY_MAX_MIN}
        max={OFFER_PARTY_MAX_MAX}
        value={partyMax}
        onChange={(event) => setPartyMax(event.target.value)}
      />
      <FieldMessage name="partyMax" failure={failure} ctx={{ field: "何名まで", min: OFFER_PARTY_MAX_MIN, max: OFFER_PARTY_MAX_MAX }} />

      <label htmlFor="publish-until">何時まで</label>
      <input id="publish-until" data-testid="field-until" type="time" value={until} onChange={(event) => setUntil(event.target.value)} />
      <FieldMessage name="until" failure={failure} ctx={{ field: "何時まで" }} />

      <button type="submit" data-testid="btn-publish">
        公開する
      </button>
      <FormMessage failure={failure} fieldNames={FIELD_NAMES} links={PROFILE_LINKS} />
    </form>
  );
};

export default PublishForm;
