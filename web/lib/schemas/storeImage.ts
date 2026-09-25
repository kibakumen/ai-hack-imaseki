// 店の雰囲気画像の問い合わせの入力の形（入口 GET /api/customer/store-image）。
// 読むだけの入口なので、値は問い合わせ文字列（`?storeId=…`）で届く＝必ず文字列（schemas/place.ts と同じ考え）。
//
// 2026-09-25 監査の指摘 安全-12 で、入力を「任意の URL」から「店の番号」へ替えた。サーバーが客の渡した URL を
// 取りに行く形は、外向きの GET の踏み台になっていた。今は承認済みの店の、置き場に置いた画像を返すだけ。

import { z } from "zod";
import { ID_MAX_LENGTH } from "./limits";

export const storeImageQuerySchema = z.object({
  storeId: z.string().min(1).max(ID_MAX_LENGTH),
});

export type StoreImageQuery = z.infer<typeof storeImageQuerySchema>;
