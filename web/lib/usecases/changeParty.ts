// 客による確保の人数の変更（要件10の基準 10.4・10.6・10.7・10.9）。
//
// 順は4つ:
//   1. その客の確保を読む（在らない番号・別の客の確保は入力の断りへ倒す＝存在を教えない）
//   2. 確保中か・「何名まで」に照らして受け入れられるかを判断する（`domain/reservation`）
//   3. **前の状態を WHERE に入れた1つの UPDATE**（人数の列だけを変える）
//   4. 新しいホームを返す（確保中の表示のまま・人数だけが変わっている）
//
// 形と範囲（1人以上10人以下・整数・空でない）は入口の入力の検査が見る（基準 10.5）。
// ここが断るのは「何名まで」を超える増やす変更（基準 10.7）と、確保中でない確保への変更だけ。

import { canChangeParty, effectiveState, type EffectiveState } from "../domain/reservation";
import type { FieldReason } from "../domain/inputRefusal";
import type { Deps } from "../ports";
import { findReservationOfCustomer, updateReservationParty } from "../repo/reservations";
import type { PartyChangeInput } from "../schemas/reservation";
import { customerHome, type CustomerHome } from "./customerHome";

export type ChangePartyResult =
  | { ok: true; home: CustomerHome }
  /** 在らない番号・別の客の確保（存在を教えない） */
  | { ok: false; status: 400; error: { kind: "invalid_input"; fields: Array<{ name: string; reason: FieldReason }> } }
  /** 確保中でない確保への変更。今の状態を返す（取り消しと同じ形・基準 10.3 と揃える） */
  | { ok: false; status: 409; current: { state: EffectiveState } }
  /** 増やす変更が「何名まで」を超えた（基準 10.7）。人数は変えず、その時点の値を添える */
  | { ok: false; status: 409; error: { kind: "party_over_max"; partyMax: number } };

/** 見分けの直後に登録が消えた場合だけ（入口が 401 に倒す）。 */
export type ChangePartyMissing = null;

const notFound: ChangePartyResult = { ok: false, status: 400, error: { kind: "invalid_input", fields: [{ name: "id", reason: "bad_format" }] } };

const stateRefusal = (state: EffectiveState): ChangePartyResult => ({ ok: false, status: 409, current: { state } });

export const changeParty = async (deps: Deps, customerId: string, reservationId: string, input: PartyChangeInput): Promise<ChangePartyResult | ChangePartyMissing> => {
  const now = deps.clock.now();
  const nowIso = now.toISOString();

  const context = await findReservationOfCustomer(deps.db, reservationId, customerId, nowIso);
  if (!context) return notFound;
  const state = effectiveState(context.reservation, now);
  if (state !== "active") return stateRefusal(state);

  // オファーが終わっていれば、`party_max` は終わった時点の値のまま（基準 10.6）。
  const partyMax = context.offer.partyMax;
  if (!canChangeParty({ current: context.reservation.party, next: input.party, partyMax })) {
    return { ok: false, status: 409, error: { kind: "party_over_max", partyMax } };
  }

  const changed = await updateReservationParty(deps.db, { reservationId, customerId, nowIso, party: input.party });
  if (!changed) {
    // 読んだあとに状態が動いた（店が取り消した・運営が店を止めた）。今の状態をそのまま返す。
    const latest = await findReservationOfCustomer(deps.db, reservationId, customerId, nowIso);
    return latest ? stateRefusal(effectiveState(latest.reservation, now)) : notFound;
  }

  const home = await customerHome(deps, customerId);
  // 見分けの直後に登録が消えた場合だけ（入口が 401 に倒す）
  if (!home) return null;
  return { ok: true, home };
};
