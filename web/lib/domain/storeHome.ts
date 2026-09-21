// 店のホームに何を出すかの判断（設計書「どの判断をどこに置くか」）。
// ⚠️ このファイルはタスク9（公開のフォームの初めの値・店の情報の足りないもの）と、
// タスク17・20（向かっている客の行）が分けて持つ。関数ごとに要件を書く。

import { formatTimeOfDay, resolveUntil } from "./until";

// ---------- 公開のフォームの初めの値（要件17の基準 17.17〜17.21） ----------

export type PublishPrefill = {
  couponIds: string[];
  capacity: number | null;
  partyMax: number | null;
  /** "HH:MM"。前回の値が今の枠に無ければ null（基準 17.19） */
  until: string | null;
};

export type LastOffer = {
  /** 公開したときに入れた組数（基準 17.17。「追加で出す」で積み上がった合計は使わない） */
  initialCapacity: number;
  /** 終わった時点の募集する組数。初めの値には使わないが、読む側の取り違えを防ぐために形に残す */
  capacity: number;
  /** 終わった時点の「何名まで」（基準 17.17） */
  partyMax: number;
  untilAt: Date;
  couponIds: string[];
};

/**
 * 前回のオファーから、公開のフォームの初めの値を決める。
 * 前回が無ければどの欄も空（基準 17.21）。削除されたクーポンはチェックから外れる（基準 17.20）。
 * 「何時まで」は、今を起点にした枠（今より後で12時間以内）に入るときだけ入れる（基準 17.18・17.19）。
 */
export const publishPrefill = ({
  lastOffer,
  coupons,
  now,
}: {
  lastOffer: LastOffer | null;
  coupons: Array<{ id: string }>;
  now: Date;
}): PublishPrefill => {
  if (!lastOffer) return { couponIds: [], capacity: null, partyMax: null, until: null };

  const alive = new Set(coupons.map((coupon) => coupon.id));
  const time = formatTimeOfDay(lastOffer.untilAt);
  // 公開のときの起点は今（設計書「「何時まで」の入力と解釈」の表）。
  const resolved = resolveUntil({ input: time, publishedAt: now, now });

  return {
    couponIds: lastOffer.couponIds.filter((id) => alive.has(id)),
    capacity: lastOffer.initialCapacity,
    partyMax: lastOffer.partyMax,
    until: resolved?.kind === "ok" ? time : null,
  };
};

// ---------- 店の情報の足りないもの（要件17の基準 17.11・要件12の基準 12.8） ----------

export type StoreProfileState = {
  name: string | null;
  address: string | null;
  genres: string[];
  budgetMin: number | null;
  budgetMax: number | null;
};

/** 入口の断り（`profile_incomplete` の `fields`）とホームの `missingProfile` が同じ答えを使う。 */
export const missingStoreProfile = (store: StoreProfileState): string[] => {
  const missing: string[] = [];
  if (!store.name || store.name.trim() === "") missing.push("name");
  if (!store.address || store.address.trim() === "") missing.push("address");
  if (store.genres.length === 0) missing.push("genres");
  if (store.budgetMin === null) missing.push("budgetMin");
  if (store.budgetMax === null) missing.push("budgetMax");
  return missing;
};
