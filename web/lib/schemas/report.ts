// 通報の入口の入力の形（要件26の基準 26.2・26.3）。数字の正本は schemas/limits.ts
// （lib/schemas は lib/domain の定数を読んでよい・依存の向き）。
//
// ⚠️ 空と空白だけは**ここで断らない**（基準 26.2）。理由はどの語で返るかが変わるため——
// zod の `min(1)` は `too_small` を出し、`http/defineRoute` がそれを `too_short` に直すが、
// 設計書「入力の誤りの出し方」の 26.3 の行は `reason` の語を **required と too_long の2つ**に
// 決めている。長すぎ（`too_long`）はここで、空欄（`required`）は手続きで返す。

import { z } from "zod";
import { ID_MAX_LENGTH, REPORT_REASON_MAX } from "./limits";

export const reportSchema = z.object({
  storeId: z.string().min(1).max(ID_MAX_LENGTH),
  reason: z.string().max(REPORT_REASON_MAX),
});

export type ReportInput = z.infer<typeof reportSchema>;
