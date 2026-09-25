// 営業許可書の登録と読み取り（要件13の基準 13.1〜13.5）。
// 種類は先頭のバイト列だけで決め（domain/fileType）、通ったものだけを置き場へ置く。
// 読む入口は2つ（上げた店・運営）で、どちらも同じこの手続きを通る（タスク表の注）。

import { detectFileType } from "../domain/fileType";
import type { Deps } from "../ports";
import { insertAdminAction } from "../repo/adminActions";
import { findApprovedLicense } from "../repo/adminStoreActions";
import { clearBannedStoreLicense, clearPendingStoreLicense, findStoreDocuments, findStoreLicenseKeys, updateStoreLicense, type StoreStatus } from "../repo/stores";
import { ID_BYTES, LICENSE_MAX_BYTES } from "../schemas/limits";
import { tokenFromBytes } from "../domain/token";
import { newAdminAction, type AdminActor } from "./adminActionRecord";
import { LICENSE_KEY_PREFIX, scheduleLicenseSweep } from "./licenseSweep";

export type UploadLicenseResult = { ok: true } | { ok: false; kind: "file_unsupported" | "file_too_large" };

export type LicenseFile = { bytes: Uint8Array; declaredSize: number };

/**
 * 置き場の鍵。店ごとに分け、上げ直すたびに新しい名前にする（古い名前は消す）。
 * 店の番号を鍵に含めるのは、置き場だけを見てもどの店のものかが辿れるようにするため
 * （運営が中身を確かめるときと、消し漏れを見つけるときに効く）。
 * 置いた時刻（ミリ秒）も頭に入れる——指されていないファイルを消す掃除（usecases/licenseSweep）が、上げている途中の
 * ファイルを見分けるため（2026-09-25 安全-20 のレビュー）。
 */
const licenseKeyFor = (deps: Deps, storeId: string): string =>
  `${LICENSE_KEY_PREFIX}${storeId}/${deps.clock.now().getTime()}-${tokenFromBytes(deps.rng.bytes(ID_BYTES))}`;

/**
 * 営業許可書を1つ受け取る。断るときは置き場にも表にも何も書かない（基準 13.3）。
 * 通ったときは前のファイルを消して置き換える（基準 13.4）。
 *
 * ⚠️ **承認に使った許可書は消さない**（2026-09-25 監査の指摘 運営-02）。承認のあとで上げ直されても、
 * 運営が審査で見たものを確かめ直せるように、承認した時点の写しが指すファイルは置き場に残す。
 * 上げた時刻も残す（運営が上げ直しに気づくため・運営-05）。
 */
export const uploadLicense = async (deps: Deps, storeId: string, file: LicenseFile): Promise<UploadLicenseResult> => {
  // 大きさは、要求が名乗った値と実際に読めた長さの大きい方で見る（名乗りを信じきらない）。
  if (Math.max(file.declaredSize, file.bytes.byteLength) > LICENSE_MAX_BYTES) return { ok: false, kind: "file_too_large" };

  const contentType = detectFileType(file.bytes);
  if (!contentType) return { ok: false, kind: "file_unsupported" };

  const previous = await findStoreDocuments(deps.db, storeId);
  const key = licenseKeyFor(deps, storeId);
  await deps.files.put(key, file.bytes, contentType);
  await updateStoreLicense(deps.db, storeId, key, contentType, deps.clock.now().toISOString());

  // 表が新しい鍵を指したあとで古いファイルを消す（順を逆にすると、途中で落ちたとき
  // 表が指す先のファイルが無くなる）。消せなくても登録そのものは成り立っている。
  //
  // 承認の写しが指す鍵は、**表を書き換えたあとで**読む（2026-09-25 のレビュー）。書き換える前に読むと、その間に入った
  // 承認が前の鍵を写し、直後にこの手続きがそのファイルを消してしまう。書き換えたあとなら、以後の承認は新しい鍵を写す。
  const approved = await findApprovedLicense(deps.db, storeId);
  if (previous?.licenseKey && previous.licenseKey !== key && previous.licenseKey !== approved?.key) {
    try {
      await deps.files.delete(previous.licenseKey);
    } catch {
      deps.logger.log({ event: "license_old_file_delete_failed", id: storeId });
    }
  }
  // 消し損ねたファイルは、指されていないファイルの掃除が拾う（1日に1回・応答のあと）
  scheduleLicenseSweep(deps);
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

/**
 * 承認に使った許可書（2026-09-25 監査の指摘 運営-02）。運営の入口だけが読む（`?version=approved`）。
 * 写しの無い店（未承認）・置き場から消えていれば null。
 */
const readApprovedLicense = async (deps: Deps, storeId: string): Promise<LicenseContent | null> => {
  const approved = await findApprovedLicense(deps.db, storeId);
  if (!approved) return null;
  const file = await deps.files.get(approved.key);
  if (!file) return null;
  return { body: file.body, contentType: approved.mime ?? file.contentType };
};

/**
 * 運営が許可書を開く（基準 13.5・24.11）。`approved` なら承認した時点の写し（運営-02）。
 * 開けたときは「誰が・いつ」を記録に残す——個人が特定できる書類なので（運営-01）。
 */
export const readLicenseAsAdmin = async (deps: Deps, storeId: string, actor: AdminActor, version: "current" | "approved"): Promise<LicenseContent | null> => {
  const file = version === "approved" ? await readApprovedLicense(deps, storeId) : await readLicense(deps, storeId);
  if (!file) return null;
  await insertAdminAction(deps.db, newAdminAction(deps, actor, "view_license", storeId, { detail: { approved: version === "approved" } }));
  return file;
};

// ---------- 許可書を消す（2026-09-25 監査の指摘 安全-20 の案1・AI判断） ----------
// 許可書には個人経営の店主の氏名と住所が載りうる。それまでファイルを消すのは上げ直したときだけで、止めた店・
// 取り下げたい店のものは期限なく残り、運営の画面からいつでも開けた。使う必要が無くなった時に消す:
//   - 運営が店を止めたとき … 今の分と承認の写しの両方（`discardLicenseOfBannedStore`・止める手続きの最後）。
//     承認の写しも外すので、戻すときは承認待ちへ戻り、店の上げ直しと運営の承認をやり直す（安全-20 のレビュー・基準 25.9）
//   - 承認の前に店が取り下げたとき … 今の分（`withdrawLicense`・入口 DELETE /api/store/license）
// 承認のときには消さない——承認の写しは、承認のあとの上げ直しと見比べるために運営が使う（運営-02）。
// 表から先に外し、そのあとでファイルを消す（逆だと、途中で落ちたとき表が無いファイルを指す）。消せなかったファイルは
// 記録に残し、どこからも指されていないファイルの掃除（usecases/licenseSweep・1日に1回）が消す（安全-20 のレビュー）。

/** 置き場からファイルを消す。消せなくても手続きは続ける（表からはもう外してある）。 */
const deleteLicenseFiles = async (deps: Deps, storeId: string, keys: ReadonlyArray<string | null>) => {
  for (const key of new Set(keys.filter((k): k is string => k !== null))) {
    try {
      await deps.files.delete(key);
    } catch {
      deps.logger.log({ event: "license_discard_failed", id: storeId });
    }
  }
};

/** 読んでから外すまでの間に鍵が変わったとき、読み直して試す回数（最初の1回を含む・安全-20 のレビュー） */
const DISCARD_ATTEMPTS = 2;

/**
 * 運営が止めた店の許可書（今の分と承認の写し）を消す。止められていなければ何もしない。
 *
 * 表から外すのは**読んだ鍵のままのときだけ**で、外した鍵のファイルを消す。止められた店は許可書を上げ直せるので、
 * 読んでから外すまでの間に新しい鍵が入ったら、読み直してもう一度だけ試す（安全-20 のレビュー: それまでは条件なしで
 * 外し、新しいファイルがどこからも指されないまま置き場に残った）。2回とも当たらなければ記録に残してやめる
 * （表は今のファイルを指したままなので、指されないファイルは生まれない）。
 */
export const discardLicenseOfBannedStore = async (deps: Deps, storeId: string, attemptsLeft = DISCARD_ATTEMPTS): Promise<void> => {
  const keys = await findStoreLicenseKeys(deps.db, storeId);
  if (!keys || keys.status !== "banned") return;
  if (await clearBannedStoreLicense(deps.db, storeId, keys)) {
    await deleteLicenseFiles(deps, storeId, [keys.licenseKey, keys.approvedLicenseKey]);
    scheduleLicenseSweep(deps);
    return;
  }
  if (attemptsLeft > 1) {
    await discardLicenseOfBannedStore(deps, storeId, attemptsLeft - 1);
    return;
  }
  deps.logger.log({ event: "license_discard_raced", id: storeId });
};

export type WithdrawLicenseResult =
  | { ok: true }
  /** 消す許可書が無い（入口は 404） */
  | { ok: false; kind: "not_found" }
  /** 承認済み（承認の根拠なので店からは消せない。退会は運営への連絡で受ける・入口は 409 で今の状況を返す） */
  | { ok: false; kind: "state"; state: StoreStatus };

/** 承認の前の店が、自分の許可書を取り下げる（消す）。 */
export const withdrawLicense = async (deps: Deps, storeId: string): Promise<WithdrawLicenseResult> => {
  const keys = await findStoreLicenseKeys(deps.db, storeId);
  if (!keys?.licenseKey) return { ok: false, kind: "not_found" };
  if (keys.status === "approved") return { ok: false, kind: "state", state: keys.status };
  if (!(await clearPendingStoreLicense(deps.db, storeId, keys.licenseKey))) {
    // 読んでから書くまでに承認された・上げ直された。今の状況を読み直して断る
    const latest = await findStoreLicenseKeys(deps.db, storeId);
    return latest?.status === "approved" ? { ok: false, kind: "state", state: latest.status } : { ok: false, kind: "not_found" };
  }
  // 承認の写し（止められた店を戻した後など）が同じ鍵を指していれば、ファイルは残す
  await deleteLicenseFiles(deps, storeId, [keys.licenseKey === keys.approvedLicenseKey ? null : keys.licenseKey]);
  deps.logger.log({ event: "license_withdrawn", id: storeId });
  scheduleLicenseSweep(deps);
  return { ok: true };
};
