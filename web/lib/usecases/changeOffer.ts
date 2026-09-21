// 公開したままの変更（要件19）。店ができるのは4つ——組数を足す（基準 19.1）／残りの募集を減らす
// （基準 19.4）／「何名まで」を上げ下げする（基準 19.6）／「何時まで」を動かす（基準 19.8）。
// 「公開を止める」（要件17の基準 17.12）はオファーを終わらせる操作なので、ここには無い。
//
// 4つとも同じ形で書く:
//   1. **公開中の条件を WHERE に入れた1つの UPDATE** を当てる（終わったオファーには当たらない・基準 19.12）
//   2. 当たらなかったら、公開中が在るかを読んで理由を分ける（無い＝ `offer_ended`／在る＝規則の断り）
//   3. 当たったら、変えたあとのカードを返す（画面はこの値で数字を出し直す）
//
// **確保には一切触れない**（基準 19.10）——人数・コード・期限・クーポンはどの操作でも変わらない。
// 変えるのは `offers` の列だけで、残りは募集する組数と確保の行から導いているので、組数を動かせば
// 残りも同じだけ動く（要件18）。
//
// 断り方は設計書「入力の断りの応答の形」に揃える——語は `domain/inputRefusal`、人が読む文は載せない。

import type { InputRefusalKind } from "../domain/inputRefusal";
import { resolveUntil } from "../domain/until";
import type { Deps } from "../ports";
import { addLiveOfferCapacity, findLiveOffer, reduceLiveOfferCapacity, updateLiveOfferPartyMax, updateLiveOfferUntil } from "../repo/offers";
import type { FieldError } from "../schemas/error";
import { OFFER_CAPACITY_MAX } from "../schemas/limits";
import type { OfferCountInput, OfferPartyMaxInput, OfferUntilInput, OfferView } from "../schemas/offer";
import { liveOfferView } from "./storeHomeOffer";

export type ChangeOfferResult =
  | { ok: true; offer: OfferView }
  | { ok: false; status: 400 | 409; kind: InputRefusalKind; fields?: FieldError[] };

/** 終わったオファーへの変更（基準 19.12）。画面はこの語だけホームを取り直して公開のフォームへ戻る。 */
const ENDED: ChangeOfferResult = { ok: false, status: 409, kind: "offer_ended" };

const countRefusal = (reason: FieldError["reason"]): ChangeOfferResult => ({
  ok: false,
  status: 400,
  kind: "invalid_input",
  fields: [{ name: "count", reason }],
});

/**
 * 変えたあとのカードを読んで返す。
 * 読んだ時にもう公開中でなければ終わりとして返す——変更は通っているが、そのあいだに「何時まで」を
 * 過ぎた場合（画面はホームを取り直して公開のフォームへ戻るので、辻褄は合う）。
 */
const changedCard = async (deps: Deps, storeId: string): Promise<ChangeOfferResult> => {
  const offer = await liveOfferView(deps, storeId);
  return offer ? { ok: true, offer } : ENDED;
};

/** UPDATE が当たらなかった理由を分ける——公開中が無いか（基準 19.12）、規則の断りか。 */
const refuseChange = async (deps: Deps, storeId: string, nowIso: string, whenLive: ChangeOfferResult): Promise<ChangeOfferResult> => {
  const live = await findLiveOffer(deps.db, storeId, nowIso);
  return live ? whenLive : ENDED;
};

/** 「追加で出す」（基準 19.1・19.2・19.3）。 */
export const addOfferCount = async (deps: Deps, storeId: string, input: OfferCountInput): Promise<ChangeOfferResult> => {
  const nowIso = deps.clock.now().toISOString();
  const added = await addLiveOfferCapacity(deps.db, { storeId, nowIso, count: input.count, remainingMax: OFFER_CAPACITY_MAX });
  // 公開中が在るのに入らなかった＝足したあとの残りが上限を超える（基準 19.2）
  return added ? changedCard(deps, storeId) : refuseChange(deps, storeId, nowIso, countRefusal("over_capacity"));
};

/** 「残りの募集を減らす」（基準 19.4・19.5）。 */
export const reduceOfferCount = async (deps: Deps, storeId: string, input: OfferCountInput): Promise<ChangeOfferResult> => {
  const nowIso = deps.clock.now().toISOString();
  const reduced = await reduceLiveOfferCapacity(deps.db, { storeId, nowIso, count: input.count });
  // 公開中が在るのに減らせなかった＝減らす数が残りを超える（基準 19.5）
  return reduced ? changedCard(deps, storeId) : refuseChange(deps, storeId, nowIso, countRefusal("over_remaining"));
};

/** 「何名まで」を上げ下げする（基準 19.6・19.7）。 */
export const changeOfferPartyMax = async (deps: Deps, storeId: string, input: OfferPartyMaxInput): Promise<ChangeOfferResult> => {
  const nowIso = deps.clock.now().toISOString();
  const updated = await updateLiveOfferPartyMax(deps.db, { storeId, nowIso, partyMax: input.partyMax });
  return updated ? changedCard(deps, storeId) : ENDED;
};

/**
 * 「何時まで」を延ばす・早める（基準 19.8・19.9・19.13）。
 *
 * 起点は**そのオファーを公開した時刻**（公開のときは「今」だったが、こちらは公開した時刻・本人選択）。
 * 「今から12時間」にすると、延ばすのを繰り返して1つのオファーをいつまでも出し続けられるため。
 * 3つの分かれ方は `domain/until.ts` が決め、ここは語へ直すだけ（要件19は項目の `reason` ではなく
 * `kind` で返す形——画面は欄の直下ではなく操作の直下に文を出す）。
 */
export const changeOfferUntil = async (deps: Deps, storeId: string, input: OfferUntilInput): Promise<ChangeOfferResult> => {
  const now = deps.clock.now();
  const nowIso = now.toISOString();
  const live = await findLiveOffer(deps.db, storeId, nowIso);
  if (!live) return ENDED;

  const resolved = resolveUntil({ input: input.until, publishedAt: new Date(live.publishedAt), now });
  // 形は入口の検査が見ているので、ここへ来るのは形が合っている値だけ（念のための倒し先）
  if (!resolved) return { ok: false, status: 400, kind: "invalid_input", fields: [{ name: "until", reason: "bad_format" }] };
  if (resolved.kind === "in_past") return { ok: false, status: 409, kind: "until_in_past" };
  if (resolved.kind === "over_window") return { ok: false, status: 409, kind: "until_over_window" };

  const updated = await updateLiveOfferUntil(deps.db, { storeId, nowIso, untilAtIso: resolved.at.toISOString() });
  return updated ? changedCard(deps, storeId) : ENDED;
};
