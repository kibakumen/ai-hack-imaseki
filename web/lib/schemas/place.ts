// 地名の問い合わせの入力の形（入口 GET /api/customer/place）。
// 読むだけの入口なので、値は問い合わせ文字列（`?lat=…&lng=…`）で届く＝**必ず文字列**。
// `z.coerce` で数へ直してから範囲を見る（`schemas/fetch.ts` の lat/lng は JSON の本文で届くので
// 数のままでよく、そちらとは受け取り方が違う）。

import { z } from "zod";

export const placeQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

export type PlaceQuery = z.infer<typeof placeQuerySchema>;
