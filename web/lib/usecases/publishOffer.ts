// オファーの公開（要件17の基準 17.1〜17.6・17.9〜17.11・要件18の基準 18.10）。
// 断り方は設計書「入力の断りの応答の形」に揃える——語は domain/inputRefusal、人が読む文は載せない。

import type { FieldReason, ServerRefusalKind } from "../domain/inputRefusal";
import { missingProfileFields } from "../domain/storeHome";
import { latestUntilOf, resolveUntil } from "../domain/until";
import { tokenFromBytes } from "../domain/token";
import type { Deps } from "../ports";
import { listCoupons } from "../repo/coupons";
import { findStorePublishState, insertOfferIfNone } from "../repo/offers";
import { ID_BYTES } from "../schemas/limits";
import type { OfferPublishInput, OfferView } from "../schemas/offer";

export type RefusalField = { name: string; reason: FieldReason };

export type PublishOfferResult =
  | { ok: true; offer: OfferView }
  /** 断りは種類だけ。状態コードへの対応は入口の表（http/refusals）が持つ（設計-13） */
  | { ok: false; kind: ServerRefusalKind; fields?: RefusalField[] };

/** 「何時まで」の3つの分かれ方を、項目の断りの語へ直す（設計書「「何時まで」の入力と解釈」の表）。 */
const untilRefusal = (kind: "in_past" | "over_window"): PublishOfferResult => ({ ok: false, kind: "invalid_input", fields: [{ name: "until", reason: kind }] });

type PublishUntil = { ok: true; at: Date; set: boolean } | { ok: false; refusal: PublishOfferResult };

/**
 * 公開の「何時まで」を時点へ直す。入れなかったら公開から12時間（置ける最長の時刻）で自動で終わる（2026-09-25
 * 監査の指摘 店-05 の案A・本人の指摘「公開終了時間は未入力でも公開可・終了タイマーとして入れる温度感」）。
 */
const resolvePublishUntil = (input: string | null, now: Date): PublishUntil => {
  if (input === null) return { ok: true, at: latestUntilOf(now), set: false };
  const resolved = resolveUntil({ input, publishedAt: now, now });
  if (!resolved) return { ok: false, refusal: { ok: false, kind: "invalid_input", fields: [{ name: "until", reason: "bad_format" }] } };
  if (resolved.kind !== "ok") return { ok: false, refusal: untilRefusal(resolved.kind) };
  return { ok: true, at: resolved.at, set: true };
};

export const publishOffer = async (deps: Deps, storeId: string, input: OfferPublishInput): Promise<PublishOfferResult> => {
  const now = deps.clock.now();
  const store = await findStorePublishState(deps.db, storeId);

  // 見分けの直後に店が消えた場合もここへ落ちる。公開は受け付けない。
  if (!store || store.status !== "approved") return { ok: false, kind: "approval_missing" };

  // 店名・住所・ジャンル・予算の幅のどれかが空なら、足りない項目を返す（基準 17.11）。
  // 店のホームの `missingProfile` と同じ1本を通す（2026-09-25 監査の指摘 設計-10: 予算を2通りの名前で返していた）。
  const missing = missingProfileFields(store);
  if (missing.length > 0) {
    return { ok: false, kind: "profile_incomplete", fields: missing.map((name) => ({ name, reason: "required" as FieldReason })) };
  }

  // 公開のときの起点は今（基準 17.5）。入れなければ公開から12時間で自動で終わる（店-05 の案A）。
  const until = resolvePublishUntil(input.until ?? null, now);
  if (!until.ok) return until.refusal;

  // 店のものでないクーポンの番号は黙って落とす（並びは店のクーポンの順＝作った順）。
  const coupons = await listCoupons(deps.db, storeId);
  const chosen = coupons.filter((coupon) => input.couponIds.includes(coupon.id));

  const id = tokenFromBytes(deps.rng.bytes(ID_BYTES));
  const publishedAtIso = now.toISOString();
  const inserted = await insertOfferIfNone(deps.db, {
    id,
    storeId,
    capacity: input.capacity,
    partyMax: input.partyMax,
    publishedAtIso,
    untilAtIso: until.at.toISOString(),
    untilSet: until.set,
    couponIds: chosen.map((coupon) => coupon.id),
  });
  // 入らなかった＝その店に公開中のオファーがもう在る（基準 17.9）。
  if (!inserted) return { ok: false, kind: "offer_exists" };
  // 応答のクーポンは、実際に付いたものだけ（読んでから入れるまでに消されたものは付いていない・不具合-13）
  const attached = chosen.filter((coupon) => inserted.couponIds.includes(coupon.id)).map(({ id, name, note }) => ({ id, name, note }));

  return {
    ok: true,
    offer: {
      id,
      capacity: input.capacity,
      // 公開した時の残りは募集する組数と同じ（要件18の基準 18.10）。
      remaining: input.capacity,
      partyMax: input.partyMax,
      untilAt: until.at.toISOString(),
      publishedAt: publishedAtIso,
      coupons: attached,
      latestUntil: latestUntilOf(now).toISOString(),
      untilSet: until.set,
    },
  };
};
