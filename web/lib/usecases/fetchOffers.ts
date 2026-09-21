// 取得の手続き（要件3〜7・27・33）。起点を決める → 候補を決める → 点数で上位10件 → AI に1回だけ聞く
// → 検査を通れば AI の選定、落ちれば点数順に倒す → 記録を残す、の順。
//
// AI を呼ぶのはこのファイルの1か所だけ（基準 7.12・構造の検査が見張る）。判断（絞り込み・点数・
// 出力の検査・倒し方）は lib/domain に置いてあり、ここは順番と入出力と記録だけを持つ。

import { filterCandidates } from "../domain/filter";
import { distanceMeters, inJapan, walkMinutes, type Point } from "../domain/geo";
import { rankStores, type Ranked } from "../domain/score";
import { fallbackResult, validateSelection, type Selection } from "../domain/selection";
import { tokenFromBytes } from "../domain/token";
import type { AiSelectResult, Deps } from "../ports";
import { findCouponsForStores, findFetchCandidates, type CandidateRow } from "../repo/fetchCandidates";
import { insertAiCall, insertFetchItems, insertFetchLog, type AiCallRecord } from "../repo/logs";
import type { FetchInput } from "../schemas/fetch";
import { ID_BYTES } from "../schemas/limits";

/** 地図のサービスの打ち切り（基準 3.5・値は AI判断） */
const GEOCODE_TIMEOUT_MS = 3000;
/** AI の打ち切り（基準 7.6・値は AI判断。受け皿の試行を含めた全体の時間） */
const AI_TIMEOUT_MS = 6000;

export type ResultCoupon = { name: string; note: string };

/** 結果の1件（基準 4.6・4.7・4.10）。 */
export type FetchResultItem = {
  offerId: string;
  storeId: string;
  storeName: string;
  walkMinutes: number;
  budgetMin: number;
  budgetMax: number;
  reason: string;
  partyMax: number;
  coupons: ResultCoupon[];
  storeUrl: string | null;
};

export type FetchOffersResult =
  | { ok: true; fetchId: string; items: FetchResultItem[] }
  | { ok: false; kind: "place_unresolved" | "invalid_input"; fields: Array<{ name: string; reason: "bad_format" | "required" }> };

/** 場所の文字を位置に直せなかった（基準 3.4・3.5・3.6 を1つの断りにまとめる）。 */
const PLACE_UNRESOLVED: FetchOffersResult = { ok: false, kind: "place_unresolved", fields: [{ name: "place", reason: "bad_format" }] };
/** 起点が1つも無い（文字も現在地も入っていない要求）。 */
const ORIGIN_MISSING: FetchOffersResult = { ok: false, kind: "invalid_input", fields: [{ name: "place", reason: "required" }] };

/**
 * 外の呼び出しを、打ち切りの合図2つと競わせる。
 * ①実時計（`AbortSignal.timeout`——実物の呼び出しを本当に止める）②差し替えられる時計
 * （`deadline`——検査が進める）。どちらかが先に鳴れば打ち切り。例外も打ち切りと同じ扱いにする
 * （呼ぶ側の場合分けを増やさないため）。
 *
 * ⚠️ `deadline` は **この関数の外で、最初の await より前に** 作る（`http/defineRoute` の
 * `verifyHuman` と同じ）。差し替えた時計は「今」を進めたその時に待っている合図しか起こさないので、
 * 進めたあとに作った合図はもう鳴らない。
 */
const raceDeadline = async <T>(timeoutMs: number, deadline: Promise<void>, run: (signal: AbortSignal) => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> => {
  const controller = new AbortController();
  const realTimeout = AbortSignal.timeout(timeoutMs);
  const giveUp = new Promise<{ ok: false }>((resolve) => {
    const stop = (): void => {
      controller.abort();
      resolve({ ok: false });
    };
    if (realTimeout.aborted) stop();
    else realTimeout.addEventListener("abort", stop, { once: true });
    void deadline.then(stop);
  });
  const work = run(controller.signal).then(
    (value) => ({ ok: true as const, value }),
    () => ({ ok: false as const }),
  );
  return Promise.race([work, giveUp]);
};

/** 絞り込み（domain/filter）と点数づけ（domain/score）の両方が見られる形に、1行を整える。 */
const toCandidate = (origin: Point, row: CandidateRow) => ({
  ...row,
  id: row.storeId,
  // 受け取れる状態は SQL（repo/sqlFragments）が既に絞ってある。domain/filter の型を満たすために置く
  receivable: true,
  storeGenres: row.genres,
  distanceMeters: distanceMeters(origin, { lat: row.lat, lng: row.lng }),
});

type Candidate = ReturnType<typeof toCandidate>;

/** 起点を決める（基準 3.2・3.4・3.5・3.6）。文字があれば現在地は使わない。 */
const resolveOrigin = async (deps: Deps, input: FetchInput, deadline: Promise<void>): Promise<{ ok: true; origin: Point } | { ok: false; refusal: FetchOffersResult }> => {
  const place = typeof input.place === "string" ? input.place.trim() : "";
  if (place !== "") {
    const answer = await raceDeadline(GEOCODE_TIMEOUT_MS, deadline, (signal) => deps.geocoder.geocode(place, { signal }));
    if (!answer.ok || !answer.value.ok) return { ok: false, refusal: PLACE_UNRESOLVED };
    const point = { lat: answer.value.lat, lng: answer.value.lng };
    // 日本の外は「位置に直せなかった」として扱う（基準 3.6）
    if (!inJapan(point)) return { ok: false, refusal: PLACE_UNRESOLVED };
    return { ok: true, origin: point };
  }
  if (typeof input.lat === "number" && typeof input.lng === "number") return { ok: true, origin: { lat: input.lat, lng: input.lng } };
  return { ok: false, refusal: ORIGIN_MISSING };
};

type AiOutcome = { selections: Selection[]; aiUsed: boolean; call: Omit<AiCallRecord, "id" | "fetchId" | "at"> | null };

/** AI に1回だけ聞いて、検査を通った選定だけを採る（基準 7.1・7.2・7.3・7.4・7.6・7.7・33.1）。 */
const askAi = async (deps: Deps, input: FetchInput, ranked: readonly Candidate[], deadline: Promise<void>): Promise<AiOutcome> => {
  const startedAt = deps.clock.now().getTime();
  const answer = await raceDeadline(AI_TIMEOUT_MS, deadline, (signal) =>
    deps.ai.select(
      {
        party: input.party,
        genres: [...(input.genres ?? [])],
        budgetMax: input.budgetMax ?? null,
        stores: ranked.map((row) => ({ id: row.id, genres: [...row.genres], menus: [...row.menus], budgetMin: row.budgetMin, budgetMax: row.budgetMax })),
      },
      { signal },
    ),
  );
  const durationMs = deps.clock.now().getTime() - startedAt;
  const result: AiSelectResult | null = answer.ok ? answer.value : null;

  if (!result || !result.ok) {
    return {
      selections: [],
      aiUsed: false,
      call: { costUsd: result?.costUsd ?? null, durationMs, succeeded: 0, validationFailed: 0, resolvedModel: null, requestId: null, fallbackLevel: null },
    };
  }
  const checked = validateSelection(result.text, ranked.map((row) => row.id));
  const call = {
    costUsd: result.costUsd,
    durationMs,
    succeeded: 1 as const,
    validationFailed: (checked.ok ? 0 : 1) as 0 | 1,
    resolvedModel: result.resolvedModel ?? null,
    requestId: result.requestId ?? null,
    fallbackLevel: result.fallbackLevel ?? null,
  };
  return checked.ok ? { selections: checked.items, aiUsed: true, call } : { selections: [], aiUsed: false, call };
};

/** 選ばれた店を、AI が返した順ではなく点数順に並べ直す（基準 4.12）。 */
const inScoreOrder = (selections: readonly Selection[], rankedIds: readonly string[]): Selection[] => {
  const position = new Map(rankedIds.map((id, index) => [id, index]));
  return [...selections].sort((a, b) => (position.get(a.storeId) ?? rankedIds.length) - (position.get(b.storeId) ?? rankedIds.length));
};

const buildItems = (selections: readonly Selection[], ranked: readonly Candidate[], coupons: readonly { id: string; storeId: string; name: string; note: string }[]): FetchResultItem[] => {
  const byStore = new Map(ranked.map((row) => [row.id, row]));
  return selections.flatMap((selection) => {
    const row = byStore.get(selection.storeId);
    if (!row) return [];
    const shown = new Set(row.couponIds);
    return [
      {
        offerId: row.offerId,
        storeId: row.storeId,
        storeName: row.storeName,
        walkMinutes: walkMinutes(row.distanceMeters),
        budgetMin: row.budgetMin,
        budgetMax: row.budgetMax,
        reason: selection.reason,
        partyMax: row.partyMax,
        // そのオファーが見せているクーポンだけを、店が作った順のまま（基準 4.7・4.8）
        coupons: coupons.filter((coupon) => coupon.storeId === row.storeId && shown.has(coupon.id)).map((coupon) => ({ name: coupon.name, note: coupon.note })),
        storeUrl: row.storeUrl,
      },
    ];
  });
};

/**
 * 取得1回。断ったとき（起点が決まらない）は記録を残さず AI も呼ばない（基準 3.4・3.5・3.6）。
 *
 * 客の登録には一切書き込まない——その回だけの好み・予算・起点を残さないのは、書き戻す場所を
 * 持たないことで守る（基準 3.14・3.15）。
 */
export const fetchOffers = async (deps: Deps, customerId: string, input: FetchInput): Promise<FetchOffersResult> => {
  // 打ち切りの合図は、最初の await より前に作る（raceDeadline の注）。
  const geocodeDeadline = deps.clock.after(GEOCODE_TIMEOUT_MS);
  const aiDeadline = deps.clock.after(AI_TIMEOUT_MS);

  const resolved = await resolveOrigin(deps, input, geocodeDeadline);
  if (!resolved.ok) return resolved.refusal;
  const origin = resolved.origin;

  // ここからが基準 33.2 の「起点が決まってから結果を返すまで」
  const startedAt = deps.clock.now();
  const nowIso = startedAt.toISOString();
  const genres = [...(input.genres ?? [])];
  const budgetMax = input.budgetMax ?? null;

  const rows = await findFetchCandidates(deps.db, nowIso);
  const candidates = filterCandidates({ origin, party: input.party, budgetMax }, rows.map((row) => toCandidate(origin, row)));
  const ranked = rankStores(candidates, genres);
  const rankedIds = ranked.map((row) => row.id);

  // 候補が0件なら AI を呼ばない（基準 7.11・6.6）
  const outcome: AiOutcome = ranked.length === 0 ? { selections: [], aiUsed: false, call: null } : await askAi(deps, input, ranked, aiDeadline);
  const selections = outcome.aiUsed ? inScoreOrder(outcome.selections, rankedIds) : fallbackResult(rankedIds);
  const coupons = await findCouponsForStores(deps.db, selections.map((selection) => selection.storeId));
  const items = buildItems(selections, ranked, coupons);

  const fetchId = await record(deps, { customerId, input, origin, genres, budgetMax, startedAt, nowIso, candidateCount: candidates.length, items, ranked, outcome });
  return { ok: true, fetchId, items };
};

type RecordInput = {
  customerId: string;
  input: FetchInput;
  origin: Point;
  genres: string[];
  budgetMax: number | null;
  startedAt: Date;
  nowIso: string;
  candidateCount: number;
  items: FetchResultItem[];
  ranked: readonly Ranked<Candidate>[];
  outcome: AiOutcome;
};

/**
 * 取得1回ぶんの記録（要件27・33）。**追加だけ**。
 * 書く順は fetch_logs → ai_calls → fetch_items（後の2つが取得の記録を指しているため）。
 */
const record = async (deps: Deps, input: RecordInput): Promise<string> => {
  const newId = (): string => tokenFromBytes(deps.rng.bytes(ID_BYTES));
  const fetchId = newId();
  const durationMs = deps.clock.now().getTime() - input.startedAt.getTime();
  await insertFetchLog(deps.db, {
    id: fetchId,
    customerId: input.customerId,
    originLat: input.origin.lat,
    originLng: input.origin.lng,
    party: input.input.party,
    genres: JSON.stringify(input.genres),
    budgetMax: input.budgetMax,
    candidateCount: input.candidateCount,
    returnedCount: input.items.length,
    aiUsed: input.outcome.aiUsed ? 1 : 0,
    durationMs,
    at: input.nowIso,
  });
  if (input.outcome.call) await insertAiCall(deps.db, { id: newId(), fetchId, ...input.outcome.call, at: deps.clock.now().toISOString() });
  const scoreByStore = new Map(input.ranked.map((row) => [row.id, row.score]));
  await insertFetchItems(
    deps.db,
    input.items.map((item, index) => ({
      id: newId(),
      fetchId,
      storeId: item.storeId,
      rank: index + 1,
      score: scoreByStore.get(item.storeId) ?? 0,
      // 倒れた取得の理由は空で残す（基準 27.2——客に出る決まった文を写すと、次のフェーズが
      // 「AI が書いた理由」と見分けられなくなる）
      reason: input.outcome.aiUsed ? item.reason : "",
    })),
  );
  deps.logger.log({ event: "fetch", id: fetchId, durationMs });
  return fetchId;
};
