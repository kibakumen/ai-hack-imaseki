// 場所の候補の問い合わせの入力の形（入口 GET /api/customer/place-suggest）。
// 読むだけの入口なので、値は問い合わせ文字列（`?q=…`）で届く＝必ず文字列（schemas/place.ts と同じ考え）。
// 字数の下限は画面が聞きに行く最小の字数と同じ定数（`PLACE_SUGGEST_MIN_CHARS`）、上限は場所の文字の上限
// （`PLACE_MAX`・基準 3.3）と同じ——候補を選んだ文字がそのまま取得の `place` に載るため。

import { z } from "zod";
import { PLACE_MAX, PLACE_SUGGEST_MIN_CHARS } from "./limits";

export const placeSuggestQuerySchema = z.object({
  q: z.string().trim().min(PLACE_SUGGEST_MIN_CHARS).max(PLACE_MAX),
});

export type PlaceSuggestQuery = z.infer<typeof placeSuggestQuerySchema>;
