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
