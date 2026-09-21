// 営業許可書の登録と読み取り（要件13の基準 13.1〜13.5）。
// 種類は先頭のバイト列だけで決め（domain/fileType）、通ったものだけを置き場へ置く。
// 読む入口は2つ（上げた店・運営）で、どちらも同じこの手続きを通る（タスク表の注）。

import { detectFileType } from "../domain/fileType";
import type { Deps } from "../ports";
import { findStoreDocuments, updateStoreLicense } from "../repo/stores";
import { ID_BYTES, LICENSE_MAX_BYTES } from "../schemas/limits";
import { tokenFromBytes } from "../domain/token";

export type UploadLicenseResult = { ok: true } | { ok: false; kind: "file_unsupported" | "file_too_large" };

export type LicenseFile = { bytes: Uint8Array; declaredSize: number };

/**
 * 置き場の鍵。店ごとに分け、上げ直すたびに新しい名前にする（古い名前は消す）。
 * 店の番号を鍵に含めるのは、置き場だけを見てもどの店のものかが辿れるようにするため
 * （運営が中身を確かめるときと、消し漏れを見つけるときに効く）。
 */
const licenseKeyFor = (deps: Deps, storeId: string): string => `licenses/${storeId}/${tokenFromBytes(deps.rng.bytes(ID_BYTES))}`;

/**
 * 営業許可書を1つ受け取る。断るときは置き場にも表にも何も書かない（基準 13.3）。
 * 通ったときは前のファイルを消して置き換える（基準 13.4）。
 */
export const uploadLicense = async (deps: Deps, storeId: string, file: LicenseFile): Promise<UploadLicenseResult> => {
  // 大きさは、要求が名乗った値と実際に読めた長さの大きい方で見る（名乗りを信じきらない）。
  if (Math.max(file.declaredSize, file.bytes.byteLength) > LICENSE_MAX_BYTES) return { ok: false, kind: "file_too_large" };

  const contentType = detectFileType(file.bytes);
  if (!contentType) return { ok: false, kind: "file_unsupported" };

  const previous = await findStoreDocuments(deps.db, storeId);
  const key = licenseKeyFor(deps, storeId);
  await deps.files.put(key, file.bytes, contentType);
  await updateStoreLicense(deps.db, storeId, key, contentType);

  // 表が新しい鍵を指したあとで古いファイルを消す（順を逆にすると、途中で落ちたとき
  // 表が指す先のファイルが無くなる）。消せなくても登録そのものは成り立っている。
  if (previous?.licenseKey && previous.licenseKey !== key) {
    try {
      await deps.files.delete(previous.licenseKey);
    } catch {
      deps.logger.log({ event: "license_old_file_delete_failed", id: storeId });
    }
  }
  return { ok: true };
};

export type LicenseContent = { body: Uint8Array; contentType: string };

/**
 * 営業許可書の中身。店の入口と運営の入口が同じここを通る（誰が読めるかは入口の見分けが決める・基準 13.5）。
 * その店に許可書が無い・置き場から消えていれば null（入口が 404 に倒す）。
 */
export const readLicense = async (deps: Deps, storeId: string): Promise<LicenseContent | null> => {
  const documents = await findStoreDocuments(deps.db, storeId);
  if (!documents?.licenseKey) return null;
  const file = await deps.files.get(documents.licenseKey);
  if (!file) return null;
  // 種類の正本は表の値（上げたときに先頭のバイト列で確かめたもの）。置き場が覚えていなくても揺れない。
  return { body: file.body, contentType: documents.licenseMime ?? file.contentType };
};
