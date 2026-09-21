// 書類（営業許可書・カード）の入口の入力の形（要件13）。
// ⚠️ 大きさと種類そのものは、ここでは見ない——中身を読まないと決められないので、手続き
// （usecases/license）が `file_too_large`・`file_unsupported` で断る。ここが見るのは「項目が在るか」だけ。

import { z } from "zod";
import { CARD_SESSION_ID_MAX } from "./limits";

/** multipart の項目として上がってくるファイル。Workers にも Node にも実行時に File が在る。 */
const uploadedFileSchema = z.custom<File>(
  (value) => typeof value === "object" && value !== null && typeof (value as File).arrayBuffer === "function" && typeof (value as File).size === "number",
);

export const licenseUploadSchema = z.object({ file: uploadedFileSchema });
export type LicenseUploadInput = z.infer<typeof licenseUploadSchema>;

/** 外のサービスから戻ってきた要求が持つ受け皿の番号。中身の意味は外のサービスだけが知る。 */
export const cardConfirmSchema = z.object({ sessionId: z.string().min(1).max(CARD_SESSION_ID_MAX) });
export type CardConfirmInput = z.infer<typeof cardConfirmSchema>;
