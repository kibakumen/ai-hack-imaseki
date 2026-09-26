// 取得の手続き（要件3〜7・27・33）。起点を決める → 候補を決める → 点数で上位10件 → AI に1回だけ聞く
// → 検査を通れば AI の選定、落ちれば点数順に倒す → 記録を残す、の順。
//
// AI を呼ぶのはこのファイルの1か所だけ（基準 7.12・構造の検査が見張る）。判断（絞り込み・点数・
// 出力の検査・倒し方）は lib/domain に置いてあり、ここは順番と入出力と記録だけを持つ。

import { filterCandidates } from "../domain/filter";
import { distanceMeters, inJapan, searchBounds, walkMinutes, type Point } from "../domain/geo";
import { rankStores, type Ranked } from "../domain/score";
import { fallbackResult, validateSelection, type Selection } from "../domain/selection";
import { tokenFromBytes } from "../domain/token";
import type { AiSelectResult, Deps } from "../ports";
import { findCouponsForStores, findFetchCandidates, type CandidateRow } from "../repo/fetchCandidates";
import { insertFetchRecord, type AiCallRecord } from "../repo/logs";
import type { FetchInput } from "../schemas/fetch";
import { ID_BYTES } from "../schemas/limits";
import { aiBudgetLeft } from "./aiBudget";
import type { AiLineMeter } from "./aiLineShare";
import { scheduleGoogleUpkeep } from "./googleUpkeep";
import { scheduleLicenseSweep } from "./licenseSweep";
import { raceDeadline } from "./deadline";
import type { PitchTarget } from "./writePitch";
import { meteredGeocoder } from "./mapsBudget";

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
  /** 店の住所（確保する前にどこにある店かを見せる・2026-09-25 監査の指摘 客-12） */
  storeAddress: string | null;
};

/**
 * 紹介文の層（usecases/writePitch）へ渡す材料。**応答の本文には載せない**——載せるのは
 * `items` だけで（入口 lib/http/endpoints/fetch が組む）、これは後段の層が使う内部の値。
 */
export type FetchOffersResult =
  | { ok: true; fetchId: string; items: FetchResultItem[]; pitchTargets: PitchTarget[] }
  | { ok: false; kind: "place_unresolved" | "invalid_input"; fields: Array<{ name: string; reason: "bad_format" | "required" }> };

/** 場所の文字を位置に直せなかった（基準 3.4・3.5・3.6 を1つの断りにまとめる）。 */
const PLACE_UNRESOLVED: FetchOffersResult = { ok: false, kind: "place_unresolved", fields: [{ name: "place", reason: "bad_format" }] };
/** 起点が1つも無い（文字も現在地も入っていない要求）。 */
const ORIGIN_MISSING: FetchOffersResult = { ok: false, kind: "invalid_input", fields: [{ name: "place", reason: "required" }] };

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

/** 決まった起点と、その種類（現在地か、打った場所か・記録に残して経路の出発地に使う・客-11）。 */
type ResolvedOrigin = { ok: true; origin: Point; kind: "here" | "place" };

/** 起点を決める（基準 3.2・3.4・3.5・3.6）。文字があれば現在地は使わない。 */
const resolveOrigin = async (deps: Deps, input: FetchInput): Promise<ResolvedOrigin | { ok: false; refusal: FetchOffersResult }> => {
  const place = typeof input.place === "string" ? input.place.trim() : "";
  if (place !== "") {
    // 地図の打ち切りの合図は、地図を呼ぶ直前（この関数の最初の await より前）に作る（raceDeadline の注）
    const answer = await raceDeadline(GEOCODE_TIMEOUT_MS, deps.clock.after(GEOCODE_TIMEOUT_MS), (signal) => meteredGeocoder(deps).geocode(place, { signal }));
    if (!answer.ok || !answer.value.ok) return { ok: false, refusal: PLACE_UNRESOLVED };
    const point = { lat: answer.value.lat, lng: answer.value.lng };
    // 日本の外は「位置に直せなかった」として扱う（基準 3.6）
    if (!inJapan(point)) return { ok: false, refusal: PLACE_UNRESOLVED };
    return { ok: true, origin: point, kind: "place" };
  }
  if (typeof input.lat === "number" && typeof input.lng === "number") return { ok: true, origin: { lat: input.lat, lng: input.lng }, kind: "here" };
  return { ok: false, refusal: ORIGIN_MISSING };
};

/** 用途（purpose）はここでは持たない——この手続きが記録するのは「店の選定」だけなので、書く側が入れる。 */
type AiOutcome = { selections: Selection[]; aiUsed: boolean; call: Omit<AiCallRecord, "id" | "fetchId" | "at" | "purpose"> | null };

/**
 * AI に1回だけ聞いて、検査を通った選定だけを採る（基準 7.1・7.2・7.3・7.4・7.6・7.7・33.1）。
 * 打ち切りの6秒は**ここで、AI を呼ぶ直前に**数え始める（2026-09-25 監査の指摘 不具合-20）——以前は手続きの先頭で
 * 作っていたので、場所の文字を位置に直す時間と D1 を読む時間まで AI の6秒から引かれていた（設計書は「起点が決まる前の
 * 時間は含めない」）。
 */
const askAi = async (deps: Deps, input: FetchInput, ranked: readonly Candidate[]): Promise<AiOutcome> => {
  const startedAt = deps.clock.now().getTime();
  const answer = await raceDeadline(AI_TIMEOUT_MS, deps.clock.after(AI_TIMEOUT_MS), (signal) =>
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
  // AI に渡したメニュー名（店が自分で書いた語）は、理由の語の検査の前に外す（不具合-07 のレビュー・domain/selection）
  const checked = validateSelection(result.text, ranked.map((row) => row.id), new Map(ranked.map((row) => [row.id, row.menus])));
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
        storeAddress: row.storeAddress,
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
export const fetchOffers = async (deps: Deps, customerId: string, input: FetchInput, opts: { aiLine?: AiLineMeter | null } = {}): Promise<FetchOffersResult> => {
  // 打ち切りの合図（地図の3秒・AI の6秒）は、それぞれ呼ぶ直前に作る（resolveOrigin・askAi）。
  const resolved = await resolveOrigin(deps, input);
  if (!resolved.ok) return resolved.refusal;
  const origin = resolved.origin;

  // ここからが基準 33.2 の「起点が決まってから結果を返すまで」
  const startedAt = deps.clock.now();
  const nowIso = startedAt.toISOString();
  const genres = [...(input.genres ?? [])];
  const budgetMax = input.budgetMax ?? null;

  // 起点の周りの四角形で先に絞ってから読む（範囲の内かは filterCandidates が決める・設計-08）
  const rows = await findFetchCandidates(deps.db, nowIso, searchBounds(origin));
  const candidates = filterCandidates({ origin, party: input.party, budgetMax }, rows.map((row) => toCandidate(origin, row)));
  const ranked = rankStores(candidates, genres);
  const rankedIds = ranked.map((row) => row.id);

  // 候補が0件なら AI を呼ばない（基準 7.11・6.6）。アプリ全体のその日の AI の予算が尽きていても呼ばない（安全-03）
  // ——どちらも AI が落ちたときと同じく点数順に倒す。
  const askable = ranked.length > 0 && (await aiBudgetLeft(deps));
  // 選定の1回も、その回線がその日に使った AI として数える（取り分では止めない・2026-09-26 本人選択・usecases/aiLineShare）
  if (askable) await opts.aiLine?.take();
  const outcome: AiOutcome = askable ? await askAi(deps, input, ranked) : { selections: [], aiUsed: false, call: null };
  const selections = outcome.aiUsed ? inScoreOrder(outcome.selections, rankedIds) : fallbackResult(rankedIds);
  const coupons = await findCouponsForStores(deps.db, selections.map((selection) => selection.storeId));
  const items = buildItems(selections, ranked, coupons);

  const fetchId = await record(deps, { customerId, input, origin, originKind: resolved.kind, genres, budgetMax, startedAt, nowIso, candidateCount: candidates.length, items, ranked, outcome });
  // Google から来た店の座標の30日の手入れ（1時間に1回まで・応答のあとに走る・設計-20）
  scheduleGoogleUpkeep(deps);
  // 営業許可書の掃除と、承認されないまま30日たった許可書の片付け（1日に1回まで・応答のあとに走る・安全-20）。
  // 定期の仕組みを持たないので、いちばんよく来る要求のついでに走らせる（許可書の操作が無い日も期限が過ぎるため）
  scheduleLicenseSweep(deps);
  return { ok: true, fetchId, items, pitchTargets: buildPitchTargets(items, ranked) };
};

/**
 * 紹介文の層へ渡す材料を、返す1件ごとに組む（店の姿＋選定が書いた理由）。
 * 理由を持たせるのは、紹介文を諦めたときにそれをそのまま出すため（客の画面に穴を残さない）。
 */
const buildPitchTargets = (items: readonly FetchResultItem[], ranked: readonly Candidate[]): PitchTarget[] => {
  const byStore = new Map(ranked.map((row) => [row.id, row]));
  return items.flatMap((item) => {
    const row = byStore.get(item.storeId);
    if (!row) return [];
    const coupon = item.coupons[0];
    return [
      {
        storeId: item.storeId,
        store: {
          name: item.storeName,
          genres: [...row.genres],
          menus: [...row.menus],
          walkMinutes: item.walkMinutes,
          budgetMin: item.budgetMin,
          budgetMax: item.budgetMax,
          couponName: coupon?.name ?? null,
          couponNote: coupon?.note ?? null,
        },
        selectionReason: item.reason,
      },
    ];
  });
};

type RecordInput = {
  customerId: string;
  input: FetchInput;
  origin: Point;
  originKind: "here" | "place";
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
 * 3つの表（fetch_logs → ai_calls → fetch_items）を**1つのまとまり**で書く（repo/logs の insertFetchRecord・
 * 2026-09-25 監査の指摘 不具合-08: 以前は3回の往復を順に待ってから最初のカードを送っていた）。
 */
const record = async (deps: Deps, input: RecordInput): Promise<string> => {
  const newId = (): string => tokenFromBytes(deps.rng.bytes(ID_BYTES));
  const fetchId = newId();
  const durationMs = deps.clock.now().getTime() - input.startedAt.getTime();
  const scoreByStore = new Map(input.ranked.map((row) => [row.id, row.score]));
  await insertFetchRecord(deps.db, {
    log: {
      id: fetchId,
      customerId: input.customerId,
      originLat: input.origin.lat,
      originLng: input.origin.lng,
      originKind: input.originKind,
      party: input.input.party,
      genres: JSON.stringify(input.genres),
      budgetMax: input.budgetMax,
      candidateCount: input.candidateCount,
      returnedCount: input.items.length,
      aiUsed: input.outcome.aiUsed ? 1 : 0,
      durationMs,
      at: input.nowIso,
    },
    // 用途は「店の選定」。紹介文の層（usecases/writePitch）は同じ表へ別の用途で足す（migrations/0002）。
    aiCall: input.outcome.call ? { id: newId(), fetchId, purpose: "select", ...input.outcome.call, at: deps.clock.now().toISOString() } : null,
    items: input.items.map((item, index) => ({
      id: newId(),
      fetchId,
      storeId: item.storeId,
      rank: index + 1,
      score: scoreByStore.get(item.storeId) ?? 0,
      // 倒れた取得の理由は空で残す（基準 27.2——客に出る決まった文を写すと、次のフェーズが
      // 「AI が書いた理由」と見分けられなくなる）
      reason: input.outcome.aiUsed ? item.reason : "",
    })),
  });
  deps.logger.log({ event: "fetch", id: fetchId, durationMs });
  return fetchId;
};
