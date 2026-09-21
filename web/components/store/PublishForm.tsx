"use client";

// オファーの公開のフォーム（要件17）。承認済みで公開中のオファーが無いときだけ、店のホームに出る。
//
// ⚠️ **2026-09-21 の並列の実装では、ここはタスク7 が置いた最小の骨**（店のホームの帯の検査が、
//    承認済みのときに公開の操作が在ることを見るため）。**中身を仕上げるのはタスク9**——
//    初めの値（`publishPrefill`）の反映・クーポン0個の案内・断りの文の出し分け・公開後の流れ。

import { useState, type FormEvent } from "react";
import { apiCall, isFailure, type ApiFailure } from "../../lib/client/api";
import { FieldMessage, FormMessage } from "../ui/InputRefusal";

export type PublishPrefill = { couponIds: string[]; capacity: number | null; partyMax: number | null; until: string | null };
export type PublishCoupon = { id: string; name: string; note: string };

export type PublishFormProps = {
  coupons: PublishCoupon[];
  prefill: PublishPrefill;
  /** 公開できたら店のホームを取り直す */
  onPublished?: () => void;
};

const FIELD_NAMES = ["capacity", "partyMax", "until"];

export const PublishForm = ({ coupons, prefill, onPublished }: PublishFormProps) => {
  const [couponIds, setCouponIds] = useState<string[]>(prefill.couponIds);
  const [capacity, setCapacity] = useState(prefill.capacity === null ? "" : String(prefill.capacity));
  const [partyMax, setPartyMax] = useState(prefill.partyMax === null ? "" : String(prefill.partyMax));
  const [until, setUntil] = useState(prefill.until ?? "");
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  const toggleCoupon = (id: string) => setCouponIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const result = await apiCall("POST", "/api/store/offers", { couponIds, capacity: Number(capacity), partyMax: Number(partyMax), until });
    if (isFailure(result)) {
      setFailure(result);
      return;
    }
    setFailure(null);
    onPublished?.();
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

      <fieldset>
        <legend>見せるクーポン</legend>
        {coupons.map((coupon) => (
          <label key={coupon.id}>
            <input type="checkbox" data-testid={`coupon-${coupon.id}`} checked={couponIds.includes(coupon.id)} onChange={() => toggleCoupon(coupon.id)} />
            {coupon.name}
          </label>
        ))}
        {couponIds.length === 0 && <p>クーポンを見せないオファーとして公開します。</p>}
      </fieldset>

      <label htmlFor="publish-capacity">募集する組数</label>
      <input id="publish-capacity" data-testid="field-capacity" type="number" value={capacity} onChange={(event) => setCapacity(event.target.value)} />
      <FieldMessage name="capacity" failure={failure} ctx={{ field: "募集する組数" }} />

      <label htmlFor="publish-party-max">何名まで</label>
      <input id="publish-party-max" data-testid="field-partyMax" type="number" value={partyMax} onChange={(event) => setPartyMax(event.target.value)} />
      <FieldMessage name="partyMax" failure={failure} ctx={{ field: "何名まで" }} />

      <label htmlFor="publish-until">何時まで</label>
      <input id="publish-until" data-testid="field-until" type="time" value={until} onChange={(event) => setUntil(event.target.value)} />
      <FieldMessage name="until" failure={failure} ctx={{ field: "何時まで", input: until }} />

      <button type="submit" data-testid="btn-publish">
        公開する
      </button>
      <FormMessage failure={failure} fieldNames={FIELD_NAMES} />
    </form>
  );
};

export default PublishForm;
