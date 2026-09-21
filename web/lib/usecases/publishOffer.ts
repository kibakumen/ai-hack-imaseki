// オファーの公開（要件17の基準 17.1〜17.6・17.9〜17.11・要件18の基準 18.10）。
// 断り方は設計書「入力の断りの応答の形」に揃える——語は domain/inputRefusal、人が読む文は載せない。

import type { FieldReason, InputRefusalKind } from "../domain/inputRefusal";
import { missingStoreProfile } from "../domain/storeHome";
import { latestUntilOf, resolveUntil } from "../domain/until";
import { tokenFromBytes } from "../domain/token";
import type { Deps } from "../ports";
import { findStorePublishState, insertOfferIfNone, listStoreCoupons } from "../repo/offers";
import { ID_BYTES } from "../schemas/limits";
import type { OfferPublishInput, OfferView } from "../schemas/offer";

export type RefusalField = { name: string; reason: FieldReason };

export type PublishOfferResult =
  | { ok: true; offer: OfferView }
  | { ok: false; status: 400 | 409; kind: InputRefusalKind; fields?: RefusalField[] };

/** 「何時まで」の3つの分かれ方を、項目の断りの語へ直す（設計書「「何時まで」の入力と解釈」の表）。 */
const untilRefusal = (kind: "in_past" | "over_window"): PublishOfferResult => ({
  ok: false,
  status: 400,
  kind: "invalid_input",
  fields: [{ name: "until", reason: kind }],
});

export const publishOffer = async (deps: Deps, storeId: string, input: OfferPublishInput): Promise<PublishOfferResult> => {
  const now = deps.clock.now();
  const store = await findStorePublishState(deps.db, storeId);

  // 見分けの直後に店が消えた場合もここへ落ちる。公開は受け付けない。
  if (!store || store.status !== "approved") return { ok: false, status: 409, kind: "approval_missing" };

  // 店名・住所・ジャンル・予算の幅のどれかが空なら、足りない項目を返す（基準 17.11）。
  const missing = missingStoreProfile(store);
  if (missing.length > 0) {
    return { ok: false, status: 409, kind: "profile_incomplete", fields: missing.map((name) => ({ name, reason: "required" as FieldReason })) };
  }

  // 公開のときの起点は今（基準 17.5）。
  const resolved = resolveUntil({ input: input.until, publishedAt: now, now });
  if (!resolved) return { ok: false, status: 400, kind: "invalid_input", fields: [{ name: "until", reason: "bad_format" }] };
  if (resolved.kind !== "ok") return untilRefusal(resolved.kind);

  // 店のものでないクーポンの番号は黙って落とす（並びは店のクーポンの順＝作った順）。
  const coupons = await listStoreCoupons(deps.db, storeId);
  const chosen = coupons.filter((coupon) => input.couponIds.includes(coupon.id));

  const id = tokenFromBytes(deps.rng.bytes(ID_BYTES));
  const publishedAtIso = now.toISOString();
  const inserted = await insertOfferIfNone(deps.db, {
    id,
    storeId,
    capacity: input.capacity,
    partyMax: input.partyMax,
    publishedAtIso,
    untilAtIso: resolved.at.toISOString(),
    couponIds: chosen.map((coupon) => coupon.id),
  });
  // 入らなかった＝その店に公開中のオファーがもう在る（基準 17.9）。
  if (!inserted) return { ok: false, status: 409, kind: "offer_exists" };

  return {
    ok: true,
    offer: {
      id,
      capacity: input.capacity,
      // 公開した時の残りは募集する組数と同じ（要件18の基準 18.10）。
      remaining: input.capacity,
      partyMax: input.partyMax,
      untilAt: resolved.at.toISOString(),
      publishedAt: publishedAtIso,
      coupons: chosen,
      latestUntil: latestUntilOf(now).toISOString(),
    },
  };
};
