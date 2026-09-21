// 店の雰囲気画像の問い合わせの入力の形（入口 GET /api/customer/store-image）。
// 読むだけの入口なので、値は問い合わせ文字列（`?url=…`）で届く＝必ず文字列（schemas/place.ts と同じ考え）。
// 形の正本（http/https だけ・長さの上限）は schemas/store.ts の urlSchema と同じ定数を使う。

import { z } from "zod";
import { HTTP_URL_PATTERN, STORE_URL_MAX } from "./limits";

export const storeImageQuerySchema = z.object({
  url: z
    .string()
    .min(1)
    .max(STORE_URL_MAX)
    .refine((value) => HTTP_URL_PATTERN.test(value)),
});

export type StoreImageQuery = z.infer<typeof storeImageQuerySchema>;
