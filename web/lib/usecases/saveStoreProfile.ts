// 店の情報の読み書き（要件15）。形と範囲は schemas/store.ts が見たあとなので、ここが見るのは
// 「規則の断り」だけ——おすすめメニューの件数（基準 15.7）・予算の最低と最高の向き（基準 15.8）と、
// 住所を位置へ直せたか（基準 15.9・15.10・15.11）。
//
// 住所が位置に直せなかったときは**何も保存しない**（基準 15.10）。住所だけを先に書いて位置を後から
// 直す形にすると、位置が古いまま客に出る店ができる。

import { inJapan } from "../domain/geo";
import type { FieldReason } from "../domain/inputRefusal";
import type { Deps } from "../ports";
import { findStoreLocation, findStoreProfile, updateStoreDetails, updateStoreProfile } from "../repo/stores";
import { GEOCODE_TIMEOUT_MS, MENUS_MAX } from "../schemas/limits";
import type { StoreProfile, StoreProfileInput } from "../schemas/store";
import { raceDeadline } from "./deadline";
import { refreshStoreImage } from "./storeImage";

export type FieldRefusal = { name: string; reason: FieldReason };

export type SaveStoreProfileResult =
  | { ok: true; profile: StoreProfile }
  /** 項目に帰せる規則の断り（400）。zod の落ちと同じ形へ揃える。 */
  | { ok: false; kind: "invalid_input"; fields: FieldRefusal[] }
  /** 住所を位置に直せなかった（409・基準 15.10）。 */
  | { ok: false; kind: "address_unresolved"; fields: FieldRefusal[] };

/**
 * 住所を位置へ直す。直せなければ null（0件・失敗・打ち切り・日本の外を同じ扱いにする・基準 15.10・15.11）。
 * 地図が 3秒 返らなければ「直せなかった」に倒す（設計書「時間の割り振り」）。打ち切りは usecases/deadline の
 * raceDeadline（差し替えた時計と AbortSignal の両方・投げた場合も打ち切りと同じ扱い）。googleUpkeep の位置直しと同じ形
 * （2026-09-25 監査の指摘 設計-11: それまで同じ競争をここに別に書いていた）。
 */
const locate = async (deps: Deps, address: string): Promise<{ lat: number; lng: number } | null> => {
  const answer = await raceDeadline(GEOCODE_TIMEOUT_MS, deps.clock.after(GEOCODE_TIMEOUT_MS), (signal) => deps.geocoder.geocode(address, { signal }));
  if (!answer.ok || !answer.value.ok) return null;
  const point = answer.value;
  return inJapan(point) ? { lat: point.lat, lng: point.lng } : null;
};

/** 店の情報を読む。見分けの直後に店が消えた場合だけ null。 */
export const readStoreProfile = async (deps: Deps, storeId: string): Promise<StoreProfile | null> => findStoreProfile(deps.db, storeId);

export const saveStoreProfile = async (deps: Deps, storeId: string, input: StoreProfileInput): Promise<SaveStoreProfileResult> => {
  // 外へ出る前に、手元で分かる断りを先に返す（地図に無駄な仕事をさせない）。
  const fields: FieldRefusal[] = [];
  if (input.menus.length > MENUS_MAX) fields.push({ name: "menus", reason: "too_many" });
  if (input.budgetMin > input.budgetMax) fields.push({ name: "budgetMin", reason: "min_over_max" });
  if (fields.length > 0) return { ok: false, kind: "invalid_input", fields };

  // 空のままの URL は「入れていない」として null に揃える（基準 15.3）。
  const url = input.url === undefined || input.url === "" ? null : input.url;
  const record = {
    name: input.name,
    address: input.address,
    url,
    genres: [...input.genres],
    menus: [...input.menus],
    budgetMin: input.budgetMin,
    budgetMax: input.budgetMax,
  };

  // 保存済みの住所と同じで、位置もあるなら、地図へ問い合わせずに前の位置のまま住所以外を書き換える
  // （2026-09-25 監査の指摘 店-18: 予算だけを直しても毎回地図を呼び、地図の不調で何も保存できなかった）。
  // 位置が消されている（利用条件の30日で消した・まだ無い）ときは問い合わせる。
  // 書く文は「住所が読んだときのままで、位置が在る」ときだけ当たる。読んでから書くまでに別のタブが住所を変えていたら
  // 当たらないので、地図へ問い合わせる道へ落とす（店-18 のレビュー: 住所 X に Y の位置が残る食い違いを作らない）。
  const current = await findStoreLocation(deps.db, storeId);
  const previousUrl = current?.url ?? null;
  const keptLocation =
    current !== null && current.address === input.address && current.lat !== null && current.lng !== null && (await updateStoreDetails(deps.db, storeId, record));
  if (!keptLocation) {
    const location = await locate(deps, input.address);
    if (!location) return { ok: false, kind: "address_unresolved", fields: [{ name: "address", reason: "not_allowed" }] };
    // 位置を Google で直した時刻も残す（利用条件の30日で取り直す起点・usecases/googleUpkeep・設計-20）
    await updateStoreProfile(deps.db, storeId, { ...record, lat: location.lat, lng: location.lng, geocodedAt: deps.clock.now().toISOString() });
  }
  // 店の雰囲気画像は、ここで1回だけ取り直して置き場に置く（客の要求のたびに外へ取りに行かない・安全-12・安全-19）。
  // 画像は飾りなので、取れなくても保存は成り立つ（refreshStoreImage は例外を外へ出さない）。
  await refreshStoreImage(deps, storeId, { url, previousUrl });
  return { ok: true, profile: record };
};
