// 人格つきの紹介文の層（速成版 `sprint/lib/personaPitch.ts` を v2 の形へ写したもの）。
//
// **店の選定（usecases/fetchOffers）とは別の後段**で、選ばれた店ごとに1本ずつ書く。
// 三段構え: ①書き手（PitchWriter.write）→ ②決定論のガード（domain/pitch）→ ③検査官（PitchWriter.judge・
// 別ベンダーのモデル）。2回まで試し、1店の時間の割り振りを超えたら決定論の文へ倒す
// （他の店の表示を優先し、粘らない）。
//
// ⚠️ `deps.pitch` が無い場面（受け入れ検査）では**層ごと走らない**——店の選定の筋も記録も、
// この層を足す前と1行も変わらない。
//
// 2026-09-21 の速成版の実測で潰した3つを、そのまま引き継いでいる:
//  ①生成が 6〜8秒かかって毎回時間切れだった → 思考を止めて 0.7〜1.1秒（adapters/orcarouter）・予算も実測へ
//  ②検査官に生のモデル名を名指しすると本番の鍵の scope で 403 → Named Router 経由（adapters/orcarouter）
//  ③指示に「評価」と書いたら検査官が褒め言葉を落とした → 落とす条件を3つに限定（adapters/orcarouter）

import { checkPitch, fallbackPitch, PITCH_CHAR_LIMIT, readJudgement } from "../domain/pitch";
import { tokenFromBytes } from "../domain/token";
import type { Deps, PitchResult, PitchStore } from "../ports";
import { insertAiCall, type AiCallPurpose } from "../repo/logs";
import { ID_BYTES } from "../schemas/limits";
import { raceDeadline } from "./deadline";

/** 1回の生成・検査の打ち切り（値は AI判断・速成版の実測に合わせた） */
const WRITE_TIMEOUT_MS = 12000;
const JUDGE_TIMEOUT_MS = 6000;
/** 1店ぶんの時間の割り振り（生成と検査を合わせた上限）。全体の蓋は呼ぶ側（usecases/streamOffers）が持つ */
const PITCH_BUDGET_MS = 15000;
/** 書き直しは1回まで（2回目で駄目なら決定論の文へ倒す） */
const MAX_ATTEMPTS = 2;

/** 紹介文を書く相手1件（選定が返した理由も持つ——倒すときはそれをそのまま使う）。 */
export type PitchTarget = { storeId: string; store: PitchStore; selectionReason: string };

export type PitchSource = "persona" | "fallback";
export type WrittenPitch = { storeId: string; reason: string; source: PitchSource };

export type WritePitchInput = {
  /** どの取得の紹介文か（記録 ai_calls.fetch_id） */
  fetchId: string;
  party: number;
  genres: string[];
  budgetMax: number | null;
  target: PitchTarget;
};

/**
 * 呼び出し1回を記録する（用途つき・migrations/0002）。記録の失敗は紹介文の結果に影響させない
 * ——ただし黙って捨てず、出口（deps.logger）に1行残す。
 */
const record = async (deps: Deps, input: { fetchId: string; purpose: AiCallPurpose; result: PitchResult; durationMs: number; validationFailed: boolean }): Promise<void> => {
  const { result } = input;
  try {
    await insertAiCall(deps.db, {
      id: tokenFromBytes(deps.rng.bytes(ID_BYTES)),
      fetchId: input.fetchId,
      purpose: input.purpose,
      costUsd: result.costUsd ?? null,
      durationMs: input.durationMs,
      succeeded: result.ok ? 1 : 0,
      validationFailed: input.validationFailed ? 1 : 0,
      resolvedModel: result.ok ? result.resolvedModel ?? null : null,
      requestId: result.ok ? result.requestId ?? null : null,
      fallbackLevel: result.ok ? result.fallbackLevel ?? null : null,
      at: deps.clock.now().toISOString(),
    });
  } catch {
    deps.logger.log({ event: "ai_call_unlogged", errorKind: input.purpose });
  }
};

/** 外の呼び出しを、実時計と差し替えられる時計の両方で打ち切る（fetchOffers と同じ形）。 */
const callWithDeadline = async (deps: Deps, timeoutMs: number, run: (signal: AbortSignal) => Promise<PitchResult>): Promise<{ result: PitchResult; durationMs: number }> => {
  const startedAt = deps.clock.now().getTime();
  const answer = await raceDeadline(timeoutMs, deps.clock.after(timeoutMs), run);
  return {
    result: answer.ok ? answer.value : { ok: false, error: "timeout", costUsd: null },
    durationMs: deps.clock.now().getTime() - startedAt,
  };
};

type Attempt = { text: string } | { critique: string };

/** 書き手に1本頼み、決定論のガードに通す（ガードで落ちたら検査官には聞かない）。 */
const writeOnce = async (deps: Deps, writer: NonNullable<Deps["pitch"]>, input: WritePitchInput, critique: string | null, timeoutMs: number): Promise<Attempt> => {
  const { result, durationMs } = await callWithDeadline(deps, timeoutMs, (signal) =>
    writer.write({ party: input.party, genres: input.genres, budgetMax: input.budgetMax, store: input.target.store, charLimit: PITCH_CHAR_LIMIT, critique }, { signal }),
  );
  if (!result.ok) {
    await record(deps, { fetchId: input.fetchId, purpose: "pitch", result, durationMs, validationFailed: false });
    return { critique: "生成が時間切れか失敗だった" };
  }
  // 上限で打ち切られた文は途中で切れている。字数の検査は通ってしまうのでここで落とす。
  const checked = result.truncated ? ({ ok: false, critique: "文が最後まで書かれなかった" } as const) : checkPitch(result.text);
  await record(deps, { fetchId: input.fetchId, purpose: "pitch", result, durationMs, validationFailed: !checked.ok });
  return checked.ok ? { text: checked.text } : { critique: checked.critique };
};

/** 検査官（別ベンダー）に聞く。読めない答えは合格に倒さない。 */
const judgeOnce = async (deps: Deps, writer: NonNullable<Deps["pitch"]>, input: WritePitchInput, text: string, timeoutMs: number): Promise<{ ok: boolean; critique: string | null }> => {
  const { store } = input.target;
  const { result, durationMs } = await callWithDeadline(deps, timeoutMs, (signal) =>
    writer.judge({ text, store: { name: store.name, genres: store.genres, menus: store.menus, couponName: store.couponName } }, { signal }),
  );
  if (!result.ok) {
    await record(deps, { fetchId: input.fetchId, purpose: "pitch_eval", result, durationMs, validationFailed: false });
    return { ok: false, critique: "検査が時間切れか失敗だった" };
  }
  const judgement = readJudgement(result.text);
  await record(deps, { fetchId: input.fetchId, purpose: "pitch_eval", result, durationMs, validationFailed: judgement === null });
  if (judgement === null) return { ok: false, critique: "検査の答えが読めなかった" };
  return judgement;
};

/**
 * 店1件ぶんの紹介文（2回まで試して、駄目なら決定論の文）。
 * 例外は外へ出さない——1店の失敗で他の店の表示を止めない。
 */
export const writePitch = async (deps: Deps, input: WritePitchInput): Promise<WrittenPitch> => {
  const { target } = input;
  const giveUp = (): WrittenPitch => ({ storeId: target.storeId, reason: fallbackPitch(target.store, target.selectionReason), source: "fallback" });
  const writer = deps.pitch;
  if (!writer) return giveUp();

  const deadline = deps.clock.now().getTime() + PITCH_BUDGET_MS;
  const left = (): number => deadline - deps.clock.now().getTime();
  let critique: string | null = null;
  try {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (left() <= 0) break;
      const written = await writeOnce(deps, writer, input, critique, Math.min(WRITE_TIMEOUT_MS, left()));
      if ("critique" in written) {
        critique = written.critique;
        continue;
      }
      if (left() <= 0) break;
      const judged = await judgeOnce(deps, writer, input, written.text, Math.min(JUDGE_TIMEOUT_MS, left()));
      if (judged.ok) return { storeId: target.storeId, reason: written.text, source: "persona" };
      critique = judged.critique;
    }
  } catch {
    deps.logger.log({ event: "pitch_failed", id: target.storeId });
  }
  return giveUp();
};
