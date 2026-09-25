// 運営の操作の記録を1行組む（2026-09-25 監査の指摘 運営-01）。書くのは repo（adminActions・adminStores）で、
// ここは「誰が・いつ・なぜ」を揃えて1つの形にするだけ。承認・取り消し・戻す・仮のパスワードの発行・
// 許可書の閲覧・メモ・承認後の変更の確かめの全部が、この1つを通る（書き方が操作ごとにずれないように）。

import { tokenFromBytes } from "../domain/token";
import type { Deps } from "../ports";
import type { AdminActionDetail, AdminActionKind, NewAdminAction } from "../repo/adminActions";
import { ID_BYTES } from "../schemas/limits";

/** 操作した運営（入口がセッションから渡す・defineRoute の ctx.accountId）。 */
export type AdminActor = { accountId: string };

/** 空白だけの理由は「理由なし」として残す（入口の形の検査は字数だけを見る）。 */
const normalizeReason = (reason: string | null | undefined): string | null => {
  const trimmed = reason?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
};

export const newAdminAction = (
  deps: Deps,
  actor: AdminActor,
  action: AdminActionKind,
  storeId: string,
  extra: { reason?: string | null; detail?: AdminActionDetail | null } = {},
): NewAdminAction => ({
  id: tokenFromBytes(deps.rng.bytes(ID_BYTES)),
  actorAccountId: actor.accountId,
  action,
  storeId,
  reason: normalizeReason(extra.reason),
  detail: extra.detail ?? null,
  atIso: deps.clock.now().toISOString(),
});
