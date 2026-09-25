// 店の雰囲気画像の手続き（2026-09-22 本人の指摘「お店の画像もほしい」・速成版 `sprint/lib/ogImage.ts` の移植）。
//
// 2026-09-25 監査の指摘 安全-12・安全-19 で形を変えた:
//   以前 … 客が `?url=` に渡した任意の URL をサーバーが取りに行き（外向きの GET の踏み台）、返した外部の URL を
//          客の端末が店のサーバーから直接読んでいた（客の接続元と時刻が店側に渡る）
//   今   … **店が情報を保存したときに1回だけ**、その店の登録の URL から画像を取って置き場に置く（refreshStoreImage）。
//          客の入口は店の番号で引き、承認済みの店の画像を自分のオリジンから返すだけ（readStoreImage・外へ出ない）
//
// 打ち切りは地図と同じ3秒（STORE_IMAGE_TIMEOUT_MS）で、差し替えた時計と AbortSignal の両方で数える
// （usecases/placeLabel と同じ置き方・raceDeadline の注）。
//
// ⚠️ **画像は見せ方の飾り**——取れなくても、置き場が落ちても、店の情報の保存は成り立たせる（例外を外へ出さない）。

import { detectImageType } from "../domain/imageType";
import type { Deps, StoreImageFile } from "../ports";
import { isStoreApproved } from "../repo/stores";
import { STORE_IMAGE_TIMEOUT_MS } from "../schemas/limits";
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

/** 客に見せる店の画像。承認済みの店で、画像を置いてあるときだけ。それ以外は null（入口が 404 にする）。 */
export const readStoreImage = async (deps: Deps, storeId: string): Promise<StoreImageFile | null> => {
  if (!(await isStoreApproved(deps.db, storeId))) return null;
  const file = await deps.files.get(imageKeyOf(storeId));
  // 置き場の中身も、受け付ける種類の画像でなければ返さない（置いたあとに書き換えられた場合の備え）。
  if (!file) return null;
  const contentType = detectImageType(file.body);
  return contentType ? { body: file.body, contentType } : null;
};
