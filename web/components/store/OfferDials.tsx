"use client";

// 公開中のカードの2本のダイヤル——配信数と何名まで（2026-09-25 監査の指摘 設計-16 で OfferPanel から分けた。
// 振る舞いは分ける前と同じ）。見た目はダイヤル、送るのは目に出さない1操作ずつの欄とボタン（HiddenControl）。
//
// ⚠️ **受け入れ検査が掴む `<form>`（`form-add` `form-reduce` `form-party-max`）と、その中の `<input>`・ボタンは
//    DOM に残す**。断りの文は**その操作の `<form>` の中**に出る（検査が `within(form)` で引く）。

import type { OfferViewDto } from "../../lib/client/api";
import { OFFER_CAPACITY_MAX, OFFER_CAPACITY_MIN, OFFER_PARTY_MAX_MAX, OFFER_PARTY_MAX_MIN } from "../../lib/schemas/limits";
import { FieldMessage, FormMessage, fieldAria, type RefusalContext } from "../ui/InputRefusal";
import { HiddenControl, NextValue } from "./OfferPanelParts";
import type { OfferTuning } from "./useOfferTuning";
import { Wheel } from "./WheelPicker";

type DialProps = { offer: OfferViewDto; tuning: OfferTuning };

/** 配信数。1つのダイヤルを add と reduce の2つの入口へ振り分ける（増やせば add・減らせば reduce・店-09）。 */
export const CapacityDial = ({ offer, tuning }: DialProps) => {
  const { range, capacity, changes, values, edit, submit } = tuning;
  const ctxCount = (field: string): RefusalContext => ({ field, min: OFFER_CAPACITY_MIN, max: OFFER_CAPACITY_MAX, remaining: offer.remaining, sold: range.sold });
  return (
    <div className={capacity.changed ? "store-tune__dial store-tune__dial--changed" : "store-tune__dial"} data-testid="dial-capacity">
      <p className="store-label">配信数</p>
      <Wheel min={range.min} max={range.max} value={capacity.target} onChange={capacity.onDial} unit="組" size="lg" />
      {/* ダイヤルは今の値を指しているので、「今 → 次」は変えたときだけ出す（縦を詰める・店-06） */}
      {capacity.changed ? <NextValue now={String(offer.capacity)} next={capacity.target} unit=" 組" /> : null}
      {range.sold > 0 ? <p className="store-note store-tune__floor">受け取り済みの {range.sold} 組より下げられません</p> : null}
      <form className="store-tune__form" data-testid="form-add" noValidate onSubmit={submit.add}>
        <HiddenControl
          action="add"
          inputId="offer-add-count"
          testId="field-count"
          label="追加で出す組数"
          button="追加で出す"
          type="number"
          min={OFFER_CAPACITY_MIN}
          max={OFFER_CAPACITY_MAX}
          value={values.addCount}
          onChange={edit.addCount}
          aria={fieldAria("count", changes.add.failure, "offer-add-count")}
        />
        <FieldMessage inputId="offer-add-count" name="count" failure={changes.add.failure} ctx={ctxCount("追加で出す組数")} />
        <FormMessage failure={changes.add.failure} fieldNames={["count"]} ctx={ctxCount("追加で出す組数")} />
      </form>
      <form className="store-tune__form" data-testid="form-reduce" noValidate onSubmit={submit.reduce}>
        <HiddenControl
          action="reduce"
          inputId="offer-reduce-count"
          testId="field-count"
          label="減らす組数"
          button="残りを減らす"
          type="number"
          min={OFFER_CAPACITY_MIN}
          max={OFFER_CAPACITY_MAX}
          value={values.reduceCount}
          onChange={edit.reduceCount}
          aria={fieldAria("count", changes.reduce.failure, "offer-reduce-count")}
        />
        <FieldMessage inputId="offer-reduce-count" name="count" failure={changes.reduce.failure} ctx={ctxCount("減らす組数")} />
        <FormMessage failure={changes.reduce.failure} fieldNames={["count"]} ctx={ctxCount("減らす組数")} />
      </form>
    </div>
  );
};

const CTX_PARTY: RefusalContext = { field: "何名まで", min: OFFER_PARTY_MAX_MIN, max: OFFER_PARTY_MAX_MAX };

/** 何名まで。 */
export const PartyMaxDial = ({ offer, tuning }: DialProps) => {
  const { party, changes, values, submit } = tuning;
  return (
    <div className={party.changed ? "store-tune__dial store-tune__dial--changed" : "store-tune__dial"}>
      <p className="store-label">何名まで</p>
      <Wheel min={OFFER_PARTY_MAX_MIN} max={OFFER_PARTY_MAX_MAX} value={party.target} onChange={party.onDial} unit="名" size="lg" />
      {party.changed ? <NextValue now={String(offer.partyMax)} next={values.partyMax} unit=" 名" /> : null}
      <form className="store-tune__form" data-testid="form-party-max" noValidate onSubmit={submit.partyMax}>
        <HiddenControl
          action="party-max"
          inputId="offer-party-max"
          testId="field-partyMax"
          label="何名までを変える"
          button="変える"
          type="number"
          min={OFFER_PARTY_MAX_MIN}
          max={OFFER_PARTY_MAX_MAX}
          value={values.partyMax}
          onChange={party.onDial}
          aria={fieldAria("partyMax", changes.partyMax.failure, "offer-party-max")}
        />
        <FieldMessage inputId="offer-party-max" name="partyMax" failure={changes.partyMax.failure} ctx={CTX_PARTY} />
        <FormMessage failure={changes.partyMax.failure} fieldNames={["partyMax"]} ctx={CTX_PARTY} />
      </form>
    </div>
  );
};
