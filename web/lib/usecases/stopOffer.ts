// オファーの公開の停止（要件17の基準 17.12・17.13・17.16）。
// 終わりにするのは `ended_at` と `end_reason` だけで、**確保には触れない**——店が止めても、
// すでに確保している客の確保は確保中のまま（基準 17.16）。残りも戻さない（オファーが終わるので、
// その枠を別の客が受け取ることは無い）。

import type { InputRefusalKind } from "../domain/inputRefusal";
import type { Deps } from "../ports";
import { stopLiveOffer } from "../repo/offers";

export type StopOfferResult = { ok: true } | { ok: false; status: 409; kind: InputRefusalKind };

export const stopOffer = async (deps: Deps, storeId: string): Promise<StopOfferResult> => {
  const nowIso = deps.clock.now().toISOString();
  const stopped = await stopLiveOffer(deps.db, storeId, nowIso);
  // 公開中が無い＝もう終わっている（止めたあと・「何時まで」を過ぎたあと）。
  return stopped ? { ok: true } : { ok: false, status: 409, kind: "offer_ended" };
};
