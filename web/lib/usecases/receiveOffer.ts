// 受け取りと受け取り直しの手続き（要件8・要件9・要件11の基準 11.10・要件16の基準 16.6・
// 要件18の基準 18.1・要件27の基準 27.3・27.4）。
//
// 受け取りと受け取り直しは**同じ手続き・同じ1文の INSERT** を通る（設計書「入口の一覧」の注）。
// 違うのは入口の形だけ——受け取りはオファーの番号と人数、受け取り直しは元の確保の番号（人数は
// 元の確保から取る・基準 11.10）。
//
// 順は次の6つ:
//   1. 入力を「受け取り」か「受け取り直し」に決める（受け取り直しは元の確保の条件も見る）
//   2. 受け取った時点のクーポンの写しを読む（基準 16.6）
//   3. 空いているコードを1つ作る（基準 8.2・8.3）
//   4. **WHERE つきの1文の INSERT**（受け取れる状態／人数／確保中の確保が無い・基準 8.6〜8.8）
//   5. 入らなかったら、読み直して理由と次の一手を決める（`domain/receiveRefusal`）
//   6. 入ったら、選択と状態の変化を記録する（基準 27.3・27.4）
//
// ⚠️ `domain/receiveRefusal` を値として import してよいのはこのファイルだけ（構造の検査）。

import { codeFromBytes, nextCode } from "../domain/code";
import type { CustomerHomeView, ReservationView } from "../domain/customerHome";
import { classify, nextStep, type NextStep, type ReceiveRefusalKind } from "../domain/receiveRefusal";
import { effectiveState, isWithinExpiredGrace, RESERVATION_HOLD_MS } from "../domain/reservation";
import { tokenFromBytes } from "../domain/token";
import type { Deps } from "../ports";
import { insertReservationEvent, insertSelection } from "../repo/logs";
import {
  fetchLogBelongsTo,
  findOfferForReceive,
  findOfferSnapshot,
  findReservationOfCustomer,
  hasActiveReservation,
  insertReservationIfReceivable,
  isCodeTaken,
} from "../repo/reservations";
import type { ReceiveInput } from "../schemas/reservation";
import { CODE_BYTES, CODE_DRAW_ATTEMPTS, CODE_SEARCH_ATTEMPTS, ID_BYTES } from "../schemas/limits";
import { customerHome, type CustomerHome } from "./customerHome";

/** 受け取りの断り（基準 8.6）。入力の断り（`error`）とは別の形（設計書「入口の一覧」の注）。 */
export type ReceiveRefusalBody = { kind: ReceiveRefusalKind; partyMax?: number; nextStep: NextStep };

export type ReceiveOfferResult =
  | { ok: true; reservation: ReservationView; home: CustomerHome }
  /** 入力の断り（形・範囲・足りない項目）。全部の入口で1つの形 */
  | { ok: false; status: 400; error: { kind: "invalid_input"; fields: Array<{ name: string; reason: "required" | "bad_format" }> } }
  /** 受け取りの断り。理由・次の一手・新しいホームを1つの応答で返す */
  | { ok: false; status: 409; refusal: ReceiveRefusalBody; home: CustomerHome };

/** 見分けの直後に登録が消えた場合だけ（入口が 401 に倒す）。 */
export type ReceiveOfferMissing = null;

const invalidInput = (fields: Array<{ name: string; reason: "required" | "bad_format" }>): ReceiveOfferResult => ({
  ok: false,
  status: 400,
  error: { kind: "invalid_input", fields },
});

const newId = (deps: Deps): string => tokenFromBytes(deps.rng.bytes(ID_BYTES));

/**
 * 空いているコードを1つ。まず乱数を引き直し（`CODE_DRAW_ATTEMPTS` 回）、それでも重なるときは
 * 隣の値を見る（基準 8.3——完了済み・取り消された確保のものとも重ならない）。
 *
 * 最後まで空きが無ければ、重なったままの値を返す——表の一意の制約が INSERT を落とすので、
 * 同じコードが2つの確保を指すことは起きない（黙って重ねない）。
 */
const freshCode = async (deps: Deps): Promise<string> => {
  let code = codeFromBytes(deps.rng.bytes(CODE_BYTES));
  for (let attempt = 0; attempt < CODE_SEARCH_ATTEMPTS; attempt++) {
    if (!(await isCodeTaken(deps.db, code))) return code;
    code = attempt < CODE_DRAW_ATTEMPTS ? codeFromBytes(deps.rng.bytes(CODE_BYTES)) : nextCode(code, 1);
  }
  return code;
};

/** 何を受け取るか（どちらの入口の形でも、この3つに落ちる）。 */
type ReceivePlan = { offerId: string; party: number; fetchId: string };

type PlanResult = { ok: true; plan: ReceivePlan } | { ok: false; refusal: ReceiveOfferResult } | { ok: false; refuseWith: "classify"; offerId: string; party: number };

/**
 * 受け取り直し（基準 11.10）の条件——元の確保が、**その客のもので・期限切れで・期限から20分以内**。
 * 満たさないときは断る（完了済み・取り消された・20分を過ぎた確保からは受け取り直せない）。
 */
const planRetry = async (deps: Deps, customerId: string, retryOf: string, nowIso: string, now: Date): Promise<PlanResult> => {
  const context = await findReservationOfCustomer(deps.db, retryOf, customerId, nowIso);
  // 在らない番号・別の客の確保は、入力の断り（存在を教えない）
  if (!context) return { ok: false, refusal: invalidInput([{ name: "retryOf", reason: "bad_format" }]) };
  const { reservation } = context;
  const state = effectiveState(reservation, now);
  if (state !== "expired" || !isWithinExpiredGrace(reservation, now)) {
    // 受け取り直せない元の確保。**理由は読み直して決める**（設計書「入口の一覧」の注の倒し方）——
    // 画面はこの応答の `home` で自分を作り直し、完了済み・期限切れの表示そのものが答えになる。
    return { ok: false, refuseWith: "classify", offerId: reservation.offerId, party: reservation.party };
  }
  return { ok: true, plan: { offerId: reservation.offerId, party: reservation.party, fetchId: reservation.fetchId } };
};

/** 受け取り（基準 8.1）——オファーの番号・人数・どの取得から選んだか、の3つが揃っていること。 */
const planReceive = async (deps: Deps, customerId: string, input: ReceiveInput): Promise<PlanResult> => {
  const missing: Array<{ name: string; reason: "required" | "bad_format" }> = [];
  if (!input.offerId) missing.push({ name: "offerId", reason: "required" });
  if (input.party === undefined) missing.push({ name: "party", reason: "required" });
  if (!input.fetchId) missing.push({ name: "fetchId", reason: "required" });
  if (missing.length > 0) return { ok: false, refusal: invalidInput(missing) };

  const plan = { offerId: input.offerId as string, party: input.party as number, fetchId: input.fetchId as string };
  if (!(await fetchLogBelongsTo(deps.db, plan.fetchId, customerId))) {
    return { ok: false, refusal: invalidInput([{ name: "fetchId", reason: "bad_format" }]) };
  }
  return { ok: true, plan };
};

/** 断った理由を読み直して決め、次の一手と新しいホームを載せる（設計書「受け取りが断られたとき」）。 */
const refuse = async (deps: Deps, customerId: string, offerId: string, party: number, nowIso: string, now: Date): Promise<ReceiveOfferResult | ReceiveOfferMissing> => {
  const found = await findOfferForReceive(deps.db, offerId, nowIso);
  const refusal = classify(
    {
      storeBanned: found?.storeBanned ?? false,
      offer: found ? { ...found.offer } : null,
      party,
      hasActiveReservation: await hasActiveReservation(deps.db, customerId, nowIso),
    },
    now,
  );
  const home = await customerHome(deps, customerId);
  if (!home) return null;
  return { ok: false, status: 409, refusal: { ...refusal, nextStep: nextStep(refusal.kind, home as CustomerHomeView) }, home };
};

/**
 * 受け取り1回。確保を作れたら、その確保と新しいホーム（確保中の表示）を返す。
 *
 * 客の登録には一切書き込まない（受け取りで変わるのは確保と記録だけ）。残りの数はどこにも保存せず、
 * 募集する組数と確保の行から導く（設計書「確保の状態と、残りの数え方」）ので、基準 18.1 の
 * 「1減る」はこの INSERT がそのまま満たす。
 */
export const receiveOffer = async (deps: Deps, customerId: string, input: ReceiveInput): Promise<ReceiveOfferResult | ReceiveOfferMissing> => {
  const now = deps.clock.now();
  const nowIso = now.toISOString();

  const planned = input.retryOf ? await planRetry(deps, customerId, input.retryOf, nowIso, now) : await planReceive(deps, customerId, input);
  if (!planned.ok) {
    if ("refusal" in planned) return planned.refusal;
    return refuse(deps, customerId, planned.offerId, planned.party, nowIso, now);
  }
  const plan = planned.plan;

  const snapshot = await findOfferSnapshot(deps.db, plan.offerId);
  // 在らないオファーは「終わった」として断る（存在の有無を客に分けて見せない）
  if (!snapshot) return refuse(deps, customerId, plan.offerId, plan.party, nowIso, now);

  const reservationId = newId(deps);
  const inserted = await insertReservationIfReceivable(deps.db, {
    id: reservationId,
    offerId: plan.offerId,
    customerId,
    fetchId: plan.fetchId,
    party: plan.party,
    code: await freshCode(deps),
    nowIso,
    // 期限は受け取った時刻から20分後（基準 8.4）
    expiresAtIso: new Date(now.getTime() + RESERVATION_HOLD_MS).toISOString(),
    couponsJson: JSON.stringify(snapshot.coupons),
  });
  if (!inserted) return refuse(deps, customerId, plan.offerId, plan.party, nowIso, now);

  // 記録は追加だけ（基準 27.7）。どの取得のどの店が選ばれたか（27.3）と、状態の変化（27.4）
  const home = await customerHome(deps, customerId);
  // 見分けの直後に登録が消えた場合だけ（入口が 401 に倒す）
  if (!home?.reservation) return null;
  await insertSelection(deps.db, { id: newId(deps), fetchId: plan.fetchId, storeId: snapshot.storeId, at: nowIso });
  await insertReservationEvent(deps.db, { id: newId(deps), reservationId, status: "active", at: nowIso });
  deps.logger.log({ event: "receive", id: reservationId });

  return { ok: true, reservation: home.reservation, home };
};
