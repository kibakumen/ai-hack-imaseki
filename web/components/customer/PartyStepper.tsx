"use client";

// 人数の欄（2026-09-25 監査の指摘 客-07 の案A）。「今すぐ探す」の**直前**に −/＋ つきで置く。
//
// 以前は「こだわり条件（入れなくても探せます）」の中に既定の1名で置かれ、増減のボタンも無かったので、
// 4人連れの幹事がそのまま探すと1名のまま確保できた（店は1名のつもりで席を空け、来店のときにもめる）。
// 既定の1名は本人の明示の指示なので保ち、**人数が目に入る場所へ出す**ことで直す（ボタンの文言にも載せる）。
//
// 欄そのものは数の入力のまま残す（打って入れたい客と、受け入れ検査が値を入れる道のため）。
// 送る前に自分では検査しない——範囲の外や数でない値は入口の断りが欄の直下に出る（設計書の規則5）。

import type { ApiFailure } from "../../lib/client/api";
import { PARTY_MAX, PARTY_MIN } from "../../lib/schemas/limits";
import { FieldMessage, fieldAria } from "../ui/InputRefusal";

/** 欄の文字を人数として読めるか（読めなければ null）。 */
export const partyCount = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed);
  return Number.isInteger(value) ? value : null;
};

/** 1つ増やす・減らした値（範囲の中に収める）。読めない値（空欄など）からは下限にする。 */
const stepped = (raw: string, delta: number): string => {
  const current = partyCount(raw);
  if (current === null) return String(PARTY_MIN);
  return String(Math.min(PARTY_MAX, Math.max(PARTY_MIN, current + delta)));
};

type PartyStepperProps = {
  party: string;
  onPartyChange: (party: string) => void;
  failure: ApiFailure | null;
};

export const PartyStepper = ({ party, onPartyChange, failure }: PartyStepperProps) => {
  const count = partyCount(party);
  return (
    <div className="party-stepper">
      <label htmlFor="fetch-party">人数</label>
      <div className="party-stepper__row">
        <button type="button" className="party-stepper__step" data-testid="btn-party-minus" aria-label="1人減らす" disabled={count !== null && count <= PARTY_MIN} onClick={() => onPartyChange(stepped(party, -1))}>
          −
        </button>
        <input
          id="fetch-party"
          className="party-stepper__value"
          data-testid="field-party"
          type="number"
          inputMode="numeric"
          min={PARTY_MIN}
          max={PARTY_MAX}
          value={party}
          onChange={(event) => onPartyChange(event.target.value)}
          {...fieldAria("party", failure, "fetch-party")}
        />
        <span className="party-stepper__unit">名</span>
        <button type="button" className="party-stepper__step" data-testid="btn-party-plus" aria-label="1人増やす" disabled={count !== null && count >= PARTY_MAX} onClick={() => onPartyChange(stepped(party, 1))}>
          ＋
        </button>
      </div>
      <FieldMessage inputId="fetch-party" name="party" failure={failure} ctx={{ field: "人数", min: PARTY_MIN, max: PARTY_MAX }} />
    </div>
  );
};

/** 「今すぐ探す」の文言。範囲の中の人数が読めるときだけ人数を載せる（「1名で今すぐ探す」）。 */
export const fetchButtonText = (party: string): string => {
  const count = partyCount(party);
  return count !== null && count >= PARTY_MIN && count <= PARTY_MAX ? `${count}名で今すぐ探す` : "今すぐ探す";
};
