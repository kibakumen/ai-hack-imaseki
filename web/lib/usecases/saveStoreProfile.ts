// 店の情報の読み書き（要件15）。形と範囲は schemas/store.ts が見たあとなので、ここが見るのは
// 「規則の断り」だけ——おすすめメニューの件数（基準 15.7）・予算の最低と最高の向き（基準 15.8）と、
// 住所を位置へ直せたか（基準 15.9・15.10・15.11）。
//
// 住所が位置に直せなかったときは**何も保存しない**（基準 15.10）。住所だけを先に書いて位置を後から
// 直す形にすると、位置が古いまま客に出る店ができる。

import { inJapan } from "../domain/geo";
import type { FieldReason } from "../domain/inputRefusal";
import type { Deps } from "../ports";
import { findStoreProfile, updateStoreProfile } from "../repo/stores";
import { GEOCODE_TIMEOUT_MS, MENUS_MAX } from "../schemas/limits";
import type { StoreProfile, StoreProfileInput } from "../schemas/store";

export type FieldRefusal = { name: string; reason: FieldReason };

export type SaveStoreProfileResult =
  | { ok: true; profile: StoreProfile }
  /** 項目に帰せる規則の断り（400）。zod の落ちと同じ形へ揃える。 */
  | { ok: false; kind: "invalid_input"; fields: FieldRefusal[] }
  /** 住所を位置に直せなかった（409・基準 15.10）。 */
  | { ok: false; kind: "address_unresolved"; fields: FieldRefusal[] };

/** 打ち切りに当たった印。地図が 3秒 返らなければ「直せなかった」に倒す（設計書「時間の割り振り」）。 */
const TIMED_OUT: unique symbol = Symbol("geocode-timed-out");

/**
 * 住所を位置へ直す。直せなければ null（0件・失敗・打ち切り・日本の外を同じ扱いにする・基準 15.10・15.11）。
 * 打ち切りは差し替えた時計と AbortSignal の両方で書く（偽の時計が after を進める）。
 */
const locate = async (deps: Deps, address: string): Promise<{ lat: number; lng: number } | null> => {
  const controller = new AbortController();
  const deadline = deps.clock.after(GEOCODE_TIMEOUT_MS);
  const geocoding = (async () => {
    try {
      return await deps.geocoder.geocode(address, { signal: controller.signal });
    } catch {
      // 地図の呼び出しが投げた場合も「直せなかった」（基準 15.10）。
      return { ok: false as const };
    }
  })();

  const result = await Promise.race([geocoding, deadline.then((): typeof TIMED_OUT => TIMED_OUT)]);
  if (result === TIMED_OUT) {
    // 外への呼び出しを解く（実物の fetch はここで止まる）。
    controller.abort();
    return null;
  }
  if (!result.ok) return null;
  return inJapan(result) ? { lat: result.lat, lng: result.lng } : null;
};

/** 店の情報を読む。見分けの直後に店が消えた場合だけ null。 */
export const readStoreProfile = async (deps: Deps, storeId: string): Promise<StoreProfile | null> => findStoreProfile(deps.db, storeId);

export const saveStoreProfile = async (deps: Deps, storeId: string, input: StoreProfileInput): Promise<SaveStoreProfileResult> => {
  // 外へ出る前に、手元で分かる断りを先に返す（地図に無駄な仕事をさせない）。
  const fields: FieldRefusal[] = [];
  if (input.menus.length > MENUS_MAX) fields.push({ name: "menus", reason: "too_many" });
  if (input.budgetMin > input.budgetMax) fields.push({ name: "budgetMin", reason: "min_over_max" });
  if (fields.length > 0) return { ok: false, kind: "invalid_input", fields };

  const location = await locate(deps, input.address);
  if (!location) return { ok: false, kind: "address_unresolved", fields: [{ name: "address", reason: "not_allowed" }] };

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

  await updateStoreProfile(deps.db, storeId, { ...record, lat: location.lat, lng: location.lng });
  return { ok: true, profile: record };
};
