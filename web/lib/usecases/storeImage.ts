// 店の雰囲気画像の手続き（2026-09-22 本人の指摘「お店の画像もほしい」・速成版 `sprint/lib/ogImage.ts` の移植）。
//
// 2026-09-25 監査の指摘 安全-12・安全-19 で形を変えた:
//   以前 … 客が `?url=` に渡した任意の URL をサーバーが取りに行き（外向きの GET の踏み台）、返した外部の URL を
//          客の端末が店のサーバーから直接読んでいた（客の接続元と時刻が店側に渡る）
//   今   … **店が情報を保存したときに1回だけ**、その店の登録の URL から画像を取って置き場に置く（refreshStoreImage）。
//          客の入口は店の番号で引き、承認済みの店の画像を自分のオリジンから返すだけ（readStoreImage・置いてあれば外へ出ない）
//   埋め戻し（2026-09-25 のレビュー）… 置き場にまだ画像が無い承認済みの店（この直しより前に URL を保存した店・
//          ダミーデータの店・保存のときに取れなかった店）だけ、客が開いたときに**店の登録の URL** から取って置く。
//          店ごとに1日1回まで（STORE_IMAGE_BACKFILL_WINDOW_MS）。客の渡した URL は今も取りに行かない
//
// 打ち切りは地図と同じ3秒（STORE_IMAGE_TIMEOUT_MS）で、差し替えた時計と AbortSignal の両方で数える
// （usecases/placeLabel と同じ置き方・raceDeadline の注）。
//
// ⚠️ **画像は見せ方の飾り**——取れなくても、置き場が落ちても、店の情報の保存は成り立たせる（例外を外へ出さない）。

import { detectImageType } from "../domain/imageType";
import type { Deps, StoreImageFile } from "../ports";
import { hitRateCounter } from "../repo/rateCounters";
import { findApprovedStoreUrl } from "../repo/stores";
import { STORE_IMAGE_BACKFILL_WINDOW_MS, STORE_IMAGE_TIMEOUT_MS } from "../schemas/limits";
import { raceDeadline } from "./deadline";

/** 置き場の鍵。店ごとに1枚（取り直すたびに上書きする）。 */
const imageKeyOf = (storeId: string): string => `store-images/${storeId}`;

export type StoreImageChange = {
  /** 保存した URL（空なら null） */
  url: string | null;
  /** 保存の前の URL（無ければ null） */
  previousUrl: string | null;
};

/** 画像を取りに行く。取れて、中身が受け付ける種類の画像なら、その画像。それ以外は null。 */
const fetchImage = async (deps: Deps, url: string): Promise<StoreImageFile | null> => {
  const fetcher = deps.storeImage;
  if (!fetcher) return null;
  // 打ち切りの合図は、最初の await より前に作る（raceDeadline の注）。
  const deadline = deps.clock.after(STORE_IMAGE_TIMEOUT_MS);
  const answer = await raceDeadline(STORE_IMAGE_TIMEOUT_MS, deadline, (signal) => fetcher.fetch(url, { signal }));
  if (!answer.ok || !answer.value.ok) return null;
  // 種類は先頭のバイトで確かめ直す（口の答えを信じきらない。SVG・HTML を自分のオリジンから配らない）。
  const contentType = detectImageType(answer.value.image.body);
  return contentType ? { body: answer.value.image.body, contentType } : null;
};

/**
 * 店の情報を保存したときに1回だけ呼ぶ。画像を取り直して置き場に置く。
 * - URL を空にした → 前の画像を消す（外へは聞かない）
 * - 取れた → 置き場に置く（前の画像は上書き）
 * - 取れなかった → URL を変えたなら前の画像を消す（別のページの画像を出し続けない）。同じ URL なら残す
 *   （一時的な失敗で、出ていた画像を消さない）
 * この口を持たない差し替えでは何もしない。
 */
export const refreshStoreImage = async (deps: Deps, storeId: string, change: StoreImageChange): Promise<void> => {
  const key = imageKeyOf(storeId);
  try {
    if (!change.url) {
      await deps.files.delete(key);
      return;
    }
    if (!deps.storeImage) return;
    const image = await fetchImage(deps, change.url);
    if (image) {
      await deps.files.put(key, image.body, image.contentType);
      return;
    }
    if (change.url !== change.previousUrl) await deps.files.delete(key);
  } catch {
    deps.logger.log({ event: "store_image_refresh_failed", id: storeId });
  }
};

/**
 * 置き場にまだ画像が無い店の画像を、店の登録の URL から取って置く（埋め戻し・レビュー）。店ごとに1日1回まで——
 * 数えは連打の抑止の表の1文で原子的に足すので、同時に何人が開いても外へ出るのは1回。取れなければ null。
 * 画像は飾りなので、置き場や表が落ちても例外を外へ出さない（入口は 404 を返すだけ）。
 */
const backfillStoreImage = async (deps: Deps, storeId: string, url: string | null): Promise<StoreImageFile | null> => {
  if (!url || !deps.storeImage) return null;
  try {
    const attempt = await hitRateCounter(deps.db, `storeImageBackfill:${storeId}`, { nowIso: deps.clock.now().toISOString(), windowMs: STORE_IMAGE_BACKFILL_WINDOW_MS, limit: 1 });
    if (attempt.count > 1) return null;
    const image = await fetchImage(deps, url);
    if (image) await deps.files.put(imageKeyOf(storeId), image.body, image.contentType);
    return image;
  } catch {
    deps.logger.log({ event: "store_image_backfill_failed", id: storeId });
    return null;
  }
};

/**
 * 客に見せる店の画像。承認済みの店で、画像を置いてあるときだけ（まだ置いていなければ埋め戻しを1回試す）。
 * それ以外は null（入口が 404 にする）。
 */
export const readStoreImage = async (deps: Deps, storeId: string): Promise<StoreImageFile | null> => {
  const store = await findApprovedStoreUrl(deps.db, storeId);
  if (!store) return null;
  const file = (await deps.files.get(imageKeyOf(storeId))) ?? (await backfillStoreImage(deps, storeId, store.url));
  // 置き場の中身も、受け付ける種類の画像でなければ返さない（置いたあとに書き換えられた場合の備え）。
  if (!file) return null;
  const contentType = detectImageType(file.body);
  return contentType ? { body: file.body, contentType } : null;
};
