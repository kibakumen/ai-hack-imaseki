// 「受け取りが断られた理由（閉じた5種）」と「理由ごとの次の一手」のただ1つの置き場
// （設計書「どの判断をどこに置くか」・「ファイル構成の計画」）。
//
// 機械が読む識別子（ここ）と、人が読む文（domain/texts.ts）を**分けて持つ**——画面が文字列を
// 解析しないため（根拠: RFC 9457 Problem Details の設計）。
//
// ⚠️ このファイルを**値として import してよいのは `usecases/receiveOffer.ts` だけ**
//    （構造の検査 structure.test.ts が見張る）。断りを描く部品 RefusalNotice は、応答に載った
//    `kind` と `nextStep` を domain/texts の文にして描くだけ（第5周のあとの直し）。
//    単体の検査もここを値として読めないので、この2つの関数の検査は受け入れ検査 r08 が持つ。

import { isReceivable, type OfferState } from "./offer";

/** 受け取り・受け取り直しが断られる理由（設計書「受け取りが断られたとき」の作り2）。 */
export const RECEIVE_REFUSAL_KINDS = [
  /** 満席になった＝残りが0（要件18の基準 18.12） */
  "sold_out",
  /** 公開が終わった／店が止めた（要件17の基準 17.13・17.14） */
  "offer_ended",
  /** 「何名まで」が下がって人数が超えた（基準 8.6。その時点の値つき） */
  "party_over_max",
  /** すでに確保中の確保を持っている（基準 8.8・8.10） */
  "has_active_reservation",
  /** 店が運営に停止された（要件25の基準 25.7） */
  "store_banned",
] as const;
export type ReceiveRefusalKind = (typeof RECEIVE_REFUSAL_KINDS)[number];

/** 理由ごとにくっつく次の一手（設計書「受け取りが断られたとき」の作り3）。 */
export const NEXT_STEPS = ["search_again", "search_again_with_party", "back_to_reservation", "retry_same_party"] as const;
export type NextStep = (typeof NEXT_STEPS)[number];

/** 断りの応答に載る形（`partyMax` は「何名まで」が下がっていたときだけ）。 */
export type ReceiveRefusal = { kind: ReceiveRefusalKind; partyMax?: number };

/** 次の一手を決めるのに要る、新しいホームの形だけ（`domain/customerHome` の結果の一部）。 */
export type HomeForNextStep = { kind: string; expired?: { canRetry?: boolean } };

/**
 * 理由と**断った直後のホーム**の両方から、次の一手を1つ決める（設計書の作り4）。
 *
 * 「誰かに先を越された（探し直す）」と「あなたの確保が失効した（同じ人数でもう一度出す）」を
 * 混ぜない——ホームが「もう一度受け取り直せる」と言うなら、理由の対応表より**そちらを優先する**。
 * 取れるのに取れないと言うと、利用者は不具合と読む。
 */
export const nextStep = (kind: string, home: HomeForNextStep): NextStep => {
  // すでに確保を持っている＝行き先は今の確保（ホームは確保中の表示になっている）
  if (kind === "has_active_reservation") return "back_to_reservation";
  // 人数を減らせば取れる客を、探し直しの振り出しへ送らない
  if (kind === "party_over_max") return "search_again_with_party";
  if (home.kind === "expired" && home.expired?.canRetry === true) return "retry_same_party";
  return "search_again";
};

/** 断った理由を決めるために、INSERT が0行だったあとに読み直す値（設計書「入口の一覧」の注）。 */
export type ReceiveCheck = {
  /** 運営がその店を止めている（要件25の基準 25.7。オファーの終わりより先に見る） */
  storeBanned: boolean;
  /** そのオファーの今。見つからなければ null（消えたオファーは「終わった」として扱う） */
  offer: (OfferState & { partyMax: number }) | null;
  /** 受け取ろうとした人数 */
  party: number;
  /** その客が確保中の確保を持っている（基準 8.8） */
  hasActiveReservation: boolean;
};

/**
 * 断った理由を1つ決める（基準 8.6・8.8）。
 *
 * 確保を作らなかった事実そのものは INSERT の WHERE が保証していて、ここが出すのは
 * **「断った直後の見立て」**（読み直す間に状態がさらに動きうる）。5種のどれにも当たらないときは
 * 「満席になった」に倒す（最も起こりやすい理由・設計書「入口の一覧」の注）。
 */
export const classify = (check: ReceiveCheck, now: Date): ReceiveRefusal => {
  if (check.storeBanned) return { kind: "store_banned" };
  const offer = check.offer;
  if (!offer) return { kind: "offer_ended" };
  if (!isReceivable(offer, now)) {
    // 受け取れない理由は2つに割れる: 公開が終わった／満席になった
    return offer.endedAt || offer.untilAt.getTime() <= now.getTime() ? { kind: "offer_ended" } : { kind: "sold_out" };
  }
  if (check.hasActiveReservation) return { kind: "has_active_reservation" };
  if (check.party > offer.partyMax) return { kind: "party_over_max", partyMax: offer.partyMax };
  return { kind: "sold_out" };
};
