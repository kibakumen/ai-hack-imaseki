"use client";

// 公開中のカードで「回して決めて、更新するで一括」の状態と送り方（2026-09-25 監査の指摘 設計-16 で OfferPanel から
// 分けた。振る舞いは分ける前と同じ）。OfferPanel の頭の注（不具合-03・店-06・店-09）が正本。
//
// ⚠️ 打った値は丸めない・範囲へ寄せない（断られた値をそのまま残す・設計書「入力の誤りの出し方」の規則3）。
// ⚠️ 操作ごとに別の断りを持つ（useOfferChange）。「更新する」は変えたものだけを、公開中の5つの入口へ**順に**送る。

import { useState, type FormEvent } from "react";
import type { OfferViewDto } from "../../lib/client/api";
import { OFFER_CAPACITY_MAX, OFFER_CAPACITY_MIN } from "../../lib/schemas/limits";
import { timeInJst } from "../ui/jstTime";
import { useOfferChange, type OfferChange, type Outcome } from "./offerChange";

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
 * 配信数のダイヤルの範囲（2026-09-25 監査の指摘 店-09）。入口の規則に合わせる——減らせるのは残りまで（基準 19.5）
 * なので下は**受け取り済みの数**（配信数 − 残り・最小1）、足したあとの残りは20まで（基準 19.2）なので上は
 * **配信数 ＋（20 − 残り）**。それまでは 1〜20 で回せて、配信数10・残り2 の店では選べる 1〜7 がどれも断られた。
 *
 * ⚠️ **範囲には今の配信数を必ず含める**（2026-09-25 のレビュー）。誰も受け取っていないオファーで「受付を締める」を
 *    押すと配信数は0になる。下限を1のままにすると、ダイヤルは範囲の外の「0」ではなく「1」に印を付けて描き
 *    （実際と違う値を指して見える・店-04 と同じ種類の症状）、▲も押せなかった。
 */
export const capacityRange = (offer: { capacity: number; remaining: number }) => {
  const sold = Math.max(0, offer.capacity - offer.remaining);
  return {
    sold,
    min: Math.min(offer.capacity, Math.max(OFFER_CAPACITY_MIN, sold)),
    max: Math.max(offer.capacity, offer.capacity + (OFFER_CAPACITY_MAX - offer.remaining)),
  };
};

/**
 * 見せるクーポンの選択。`touched` は札に触って、まだ送っていない間だけ true。`seenKey` は最後に合わせた
 * サーバーの値（番号を「,」でつないだもの）。
 */
type CouponPick = { ids: string[]; touched: boolean; seenKey: string };

/** 1つのダイヤルぶん（配信数・何名まで）の今の値と、1操作ずつの送信。 */
export type DialState = { target: string; changed: boolean; onDial: (next: string) => void };

export const useOfferTuning = (offer: OfferViewDto, onChanged: () => void) => {
  const stop = useOfferChange("stop");
  const add = useOfferChange("add");
  const reduce = useOfferChange("reduce");
  const partyMaxChange = useOfferChange("party-max");
  const untilChange = useOfferChange("until");
  const couponsChange = useOfferChange("coupons");

  // 打った（回した）値。空欄は「変えていない」。⚠️ 丸めない・範囲へ寄せない（断られた値をそのまま残す）
  const [addCount, setAddCount] = useState("");
  const [reduceCount, setReduceCount] = useState("");
  const [partyMax, setPartyMax] = useState("");
  const [until, setUntil] = useState("");
  // 選んだクーポン。初めは今見せているもの。**札に触っていない間は、取り直しのたびにサーバーの今の値へ合わせる**
  // （2026-09-25 のレビュー）。選び直しが同じオファーのままになった（不具合-03）ので、取り直しでカードは作り直されない。
  // 描き始めの1回だけで作っていたときは、別の端末で選び直されても古い選択が残り、触っていないのに「1 項目を変えます」が
  // 出て、そのまま「更新する」を押すと別の端末の選び直しを黙って戻していた。
  const serverCouponIds = offer.coupons.map((coupon) => coupon.id);
  const serverCouponKey = serverCouponIds.join(",");
  const [couponPick, setCouponPick] = useState<CouponPick>(() => ({ ids: serverCouponIds, touched: false, seenKey: serverCouponKey }));
  if (couponPick.seenKey !== serverCouponKey) {
    // 描く途中で合わせる（props が変わったときに state を合わせる React の形。effect で後から直すと、古い選択で1回描く）
    setCouponPick((current) => ({ ids: current.touched ? current.ids : serverCouponIds, touched: current.touched, seenKey: serverCouponKey }));
  }
  const couponIds = couponPick.ids;
  /** 「更新する」を押したが、変えたところが無かった */
  const [nothingToSend, setNothingToSend] = useState(false);
  const [sending, setSending] = useState(false);

  const range = capacityRange(offer);
  // ダイヤルが指す値。配信数は「今の配信数 ＋ 追加 − 減らす」——1つのダイヤルを add と reduce の2つの
  // 入口へ振り分ける（増やせば add・減らせば reduce）。裏の欄に直接打った値もここへ合流する。
  const capacityTarget = offer.capacity + countOf(addCount) - countOf(reduceCount);
  const partyTarget = partyMax === "" ? String(offer.partyMax) : partyMax;

  const capacityChanged = addCount !== "" || reduceCount !== "";
  const partyChanged = partyMax !== "" && partyMax !== String(offer.partyMax);
  const untilChanged = until !== "" && until !== timeInJst(offer.untilAt);
  const couponsChanged = !sameIds(couponIds, serverCouponIds);
  const pendingCount = [capacityChanged, partyChanged, untilChanged, couponsChanged].filter(Boolean).length;

  const edited = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setNothingToSend(false);
  };
  const dialCapacity = (next: string) => {
    const delta = Number(next) - offer.capacity;
    setAddCount(delta > 0 ? String(delta) : "");
    setReduceCount(delta < 0 ? String(-delta) : "");
    setNothingToSend(false);
  };
  const toggleCoupon = (id: string) => {
    setCouponPick((current) => {
      const ids = current.ids.includes(id) ? current.ids.filter((value) => value !== id) : [...current.ids, id];
      // 触ってサーバーの値と同じに戻したら、また取り直しに合わせる側へ戻す
      return { ...current, ids, touched: !sameIds(ids, serverCouponIds) };
    });
    setNothingToSend(false);
  };

  /** 1操作ぶんを送る。通ったらその欄を空に戻す。 */
  const sendOne = async (change: OfferChange, body: Record<string, unknown>, reset: () => void): Promise<Outcome> => {
    const outcome = await change.send(body);
    if (outcome === "ok") reset();
    return outcome;
  };
  /** 通ったか、終わっていたらホームを取り直す（基準 19.12）。 */
  const afterOne = (outcome: Outcome) => {
    if (outcome !== "refused") onChanged();
  };
  const submitWith = (run: () => Promise<Outcome>) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void run().then(afterOne);
  };

  /** 「受付を締める」——残りの数だけ減らす（店-09）。 */
  const closeIntake = () => {
    setSending(true);
    void sendOne(reduce, { count: offer.remaining }, () => setReduceCount("")).then((outcome) => {
      setSending(false);
      afterOne(outcome);
    });
  };

  /**
   * 「更新する」——変えたものだけを、公開中の5つの入口へ**順に**送る。
   * 断られた操作の文はその操作の欄の下に残り、通った操作の欄は空に戻る。
   * 全部済んでから1回だけホームを取り直す。途中でオファーが終わっていたら、そこで止めて取り直す。
   * クーポンは差し替えの入口の1文（同じオファーのまま・不具合-03）。
   */
  const applyAll = async () => {
    const steps: Array<() => Promise<Outcome>> = [];
    if (addCount !== "") steps.push(() => sendOne(add, { count: numberToSend(addCount) }, () => setAddCount("")));
    if (reduceCount !== "") steps.push(() => sendOne(reduce, { count: numberToSend(reduceCount) }, () => setReduceCount("")));
    if (partyChanged) steps.push(() => sendOne(partyMaxChange, { partyMax: numberToSend(partyMax) }, () => setPartyMax("")));
    if (untilChanged) steps.push(() => sendOne(untilChange, { until }, () => setUntil("")));
    // 通ったら「送っていない選択」ではなくなる——次の取り直しからサーバーの値に合わせる（選択は送った値のまま待つ）
    if (couponsChanged) steps.push(() => sendOne(couponsChange, { couponIds }, () => setCouponPick((current) => ({ ...current, touched: false }))));
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

  return {
    changes: { stop, add, reduce, partyMax: partyMaxChange, until: untilChange, coupons: couponsChange },
    values: { addCount, reduceCount, partyMax, until, couponIds },
    edit: { addCount: edited(setAddCount), reduceCount: edited(setReduceCount), partyMax: edited(setPartyMax), until: edited(setUntil) },
    range,
    capacity: { target: String(capacityTarget), changed: capacityChanged, onDial: dialCapacity } satisfies DialState,
    party: { target: partyTarget, changed: partyChanged, onDial: edited(setPartyMax) } satisfies DialState,
    untilChanged,
    couponsChanged,
    pendingCount,
    nothingToSend,
    sending,
    toggleCoupon,
    submit: {
      add: submitWith(() => sendOne(add, { count: numberToSend(addCount) }, () => setAddCount(""))),
      reduce: submitWith(() => sendOne(reduce, { count: numberToSend(reduceCount) }, () => setReduceCount(""))),
      partyMax: submitWith(() => sendOne(partyMaxChange, { partyMax: numberToSend(partyMax) }, () => setPartyMax(""))),
      until: submitWith(() => sendOne(untilChange, { until }, () => setUntil(""))),
    },
    closeIntake,
    /** 「公開を止める」を確かめたあと（店-03） */
    stopOffer: () => {
      void stop.send({}).then(afterOne);
    },
    applyAll,
  };
};

export type OfferTuning = ReturnType<typeof useOfferTuning>;
