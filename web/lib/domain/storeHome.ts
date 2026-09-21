import { formatTimeOfDay, resolveUntil } from "./until";
// 店のホームに何を出すかの判断（設計書「どの判断をどこに置くか」）。副作用なし・時計も引数で受け取る。
//
// ⚠️ 2026-09-21 の並列の実装では、ここに在るのはタスク7の分（足りない店の情報）だけ。
//    **タスク9が `publishPrefill({ lastOffer, coupons, now })`**（公開のフォームの初めの値）を、
//    **タスク17が「向かっている客」の行の作り方**を、この同じファイルへ足す（タスク表の契約の行）。

/** 店のホームと運営の詳細が出す、承認の状況の3種（表の `stores.status` と同じ語）。 */
export type StoreStatusView = "pending" | "approved" | "banned";

/** 公開中のオファーのカードの中身（受け入れ検査の契約 `OfferDto`）。中身を埋めるのはタスク9。 */
export type OfferView = {
  id: string;
  capacity: number;
  remaining: number;
  partyMax: number;
  untilAt: string;
  publishedAt: string;
  coupons: Array<{ id: string; name: string; note: string }>;
  /** 公開から12時間の時刻（ISO）。「何時まで」の上限として画面が使う */
  latestUntil: string;
};

/** 「向かっている客」の1行（受け入れ検査の契約 `ArrivalRow`）。中身を埋めるのはタスク17。 */
export type ArrivalView = {
  reservationId: string;
  kind: "active" | "expired" | "completed" | "store_cancelled";
  nickname: string;
  phone: string;
  party: number;
  code: string;
  expiresAt: string;
  canComplete: boolean;
  canCancel: boolean;
};

/** 公開のフォームの初めの値。中身を埋めるのはタスク9（`publishPrefill`）。 */
export type PublishPrefillView = { couponIds: string[]; capacity: number | null; partyMax: number | null; until: string | null };

/** まだ一度も公開していない店の、公開のフォームの初めの値（どの欄も空）。 */
export const EMPTY_PUBLISH_PREFILL: PublishPrefillView = { couponIds: [], capacity: null, partyMax: null, until: null };

/** オファーを公開するために埋まっていなければならない、店の情報の項目（設計書 17.11 の行）。 */
export const REQUIRED_PROFILE_FIELDS = ["name", "address", "genres", "budget"] as const;
export type RequiredProfileField = (typeof REQUIRED_PROFILE_FIELDS)[number];

export type ProfileForPublish = {
  name: string | null;
  address: string | null;
  genres: string[];
  budgetMin: number | null;
  budgetMax: number | null;
};

const isBlank = (value: string | null): boolean => value === null || value.trim() === "";

/**
 * 公開に足りていない店の情報の項目を、決まった順で返す（要件12の基準 12.8・要件17の基準 17.11）。
 *
 * ⚠️ 店のホームの `missingProfile` と、公開を断るときの `profile_incomplete` の `fields` は、
 * **同じここを通す**（1つの責務は1か所）。片方だけを直すと、画面の案内と断りの理由がずれる。
 */
export const missingProfileFields = (profile: ProfileForPublish): RequiredProfileField[] => {
  const missing: RequiredProfileField[] = [];
  if (isBlank(profile.name)) missing.push("name");
  if (isBlank(profile.address)) missing.push("address");
  if (profile.genres.length === 0) missing.push("genres");
  if (profile.budgetMin === null || profile.budgetMax === null) missing.push("budget");
  return missing;
};

// ---------- タスク9（公開のフォームの初めの値・公開の断りの項目） ----------

// 店のホームに何を出すかの判断（設計書「どの判断をどこに置くか」）。
// ⚠️ このファイルはタスク9（公開のフォームの初めの値・店の情報の足りないもの）と、
// タスク17・20（向かっている客の行）が分けて持つ。関数ごとに要件を書く。


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
