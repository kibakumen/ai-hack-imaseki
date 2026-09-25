// 書類（営業許可書・カード）の入口の入力の形（要件13）。
// ⚠️ 大きさと種類そのものは、ここでは見ない——中身を読まないと決められないので、手続き
// （usecases/license）が `file_too_large`・`file_unsupported` で断る。ここが見るのは「項目が在るか」だけ。

import { z } from "zod";

/** multipart の項目として上がってくるファイル。Workers にも Node にも実行時に File が在る。 */
const uploadedFileSchema = z.custom<File>(
  (value) => typeof value === "object" && value !== null && typeof (value as File).arrayBuffer === "function" && typeof (value as File).size === "number",
);

export const licenseUploadSchema = z.object({ file: uploadedFileSchema });
export type LicenseUploadInput = z.infer<typeof licenseUploadSchema>;

/**
 * カードの登録の確かめ。**本文に番号を持たない**（2026-09-25 カード登録が画面から完了しない件（不具合-01）の案1）——
 * 確かめる番号は、サーバーがその店のために控えたもの。本文に何か載っていても読まない（落とす）。
 */
export const cardConfirmSchema = z.object({});
export type CardConfirmInput = z.infer<typeof cardConfirmSchema>;
