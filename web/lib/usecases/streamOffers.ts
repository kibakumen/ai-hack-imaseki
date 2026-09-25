// 取得を少しずつ届ける（速成版 `sprint/lib/db.ts:196-283` の NDJSON の配信を v2 の形へ写したもの）。
//
// 1行1つの JSON を、この順で書く:
//   ①`init`  … 店のカードを**先に**全部出す（客はここで選び始められる）
//   ②`pitch` … 店ごとの人格つきの紹介文。書けた順に届く（到着順は保証しない）
//   ③`done`  … 打ち止め
//
// 紹介文は1本ずつ AI を2往復（書き手＋検査官）するので、全部そろうのを待つと客が何秒も白い画面を
// 見ることになる。**カードを先に出して、文だけ後から差し込む**のがこの層の値打ち。
//
// 全体の蓋（STREAM_BUDGET_MS）を持つ理由: 1店 15秒の割り振り（usecases/writePitch）を店の数だけ
// 積み上げると、遅い日には1分近くかかりうる。蓋に達したら、まだ届いていない店を一斉に
// 決定論の文で確定してから閉じる（客の画面に穴を残さない）。
//
// 応答を閉じたあとの紹介文の仕事（2026-09-25 監査の指摘 設計-17・設計-18）:
//   - 蓋で閉じても、書きかけの紹介文の仕事（AI の呼び出しとその記録）は `deps.defer`（本番は ctx.waitUntil）に
//     預けて最後まで走らせる。預けないと Worker は応答を閉じた時点で残りを切り、ai_calls が本番だけ欠ける。
//   - 客が閉じた（読み手がストリームを cancel した・要求の打ち切りの合図が鳴った）ら、書き手と検査官を止める
//     （案B・費用を優先）。止めた呼び出しも失敗として記録に残る。閉じたあとの書き込み（enqueue）は投げずに捨てる。

import type { Deps } from "../ports";
import { fallbackPitch } from "../domain/pitch";
import type { FetchInput } from "../schemas/fetch";
import type { StreamLineDto } from "../schemas/responses";
import { aiBudgetLeft } from "./aiBudget";
import { fetchOffers, type FetchOffersResult } from "./fetchOffers";
import { writePitch, type PitchSource, type PitchTarget } from "./writePitch";

/** ストリーム全体の上限（値は AI判断・速成版と同じ25秒） */
const STREAM_BUDGET_MS = 25000;
/** 着手を少しずつずらす幅（近い店から先に着手する。全部並行に進めてよい） */
const PITCH_STAGGER_MS = 150;

/**
 * 1行の形。**画面と同じ定義**（schemas/responses の STREAM_LINE）から作る——画面はこの形に合わない行を捨てるので、
 * ここで項目を変えたら画面の側も型検査で落ちる（2026-09-25 監査の指摘 設計-07）。
 */
export type StreamLine = StreamLineDto;

export type StreamOffersResult = { ok: true; stream: ReadableStream<Uint8Array> } | Extract<FetchOffersResult, { ok: false }>;

/** NDJSON（1行1つの JSON）の見出し。改行で区切るので、客の側は1行ずつ読める。 */
export const NDJSON_CONTENT_TYPE = "application/x-ndjson; charset=utf-8";

/**
 * @param opts.signal 要求の打ち切りの合図（客の切断。入口が `req.signal` を渡す）。鳴ったら紹介文の AI を止める（設計-18）
 */
export const buildOffersStream = async (deps: Deps, customerId: string, input: FetchInput, opts: { signal?: AbortSignal } = {}): Promise<StreamOffersResult> => {
  const result = await fetchOffers(deps, customerId, input);
  if (!result.ok) return result;

  const encoder = new TextEncoder();
  const targets = [...result.pitchTargets];
  // アプリ全体のその日の AI の予算が尽きていたら、紹介文も AI に書かせない（安全-03・決まった文で返す）
  const pitchAllowed = deps.pitch !== undefined && targets.length > 0 && (await aiBudgetLeft(deps));
  // 蓋の合図は、最初の紹介文を頼むより前に作る（差し替えた時計は、進めたあとに作った合図を鳴らさない）
  const budget = deps.clock.after(STREAM_BUDGET_MS);

  // 1店につき紹介文は1行だけ。締め切りのあとに戻ってきた文は捨てる。
  const written = new Set<string>();
  // 打ち止めを書いたか／読み手が閉じたか。ストリームの start と cancel が共に見る
  let finished = false;
  let readerGone = false;
  // 客が閉じたら鳴らす合図。書きかけの書き手と検査官へ渡す（設計-18）。要求の打ち切り（切断）でも鳴らす
  const clientGone = new AbortController();
  if (opts.signal?.aborted) clientGone.abort();
  else opts.signal?.addEventListener("abort", () => clientGone.abort(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      const send = (line: StreamLine): void => {
        if (finished || readerGone) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        } catch {
          // 読み手がもう閉じている（next dev の「Controller is already closed」）。投げずに、客が閉じたものとして扱う
          readerGone = true;
          clientGone.abort();
        }
      };
      const sendPitch = (storeId: string, reason: string, source: PitchSource): void => {
        if (written.has(storeId)) return;
        written.add(storeId);
        send({ type: "pitch", storeId, reason, source });
      };
      /** 打ち止め。間に合わなかった店を一斉に決定論の文で確定してから閉じる（読み手が居なければ書かない） */
      const finish = (): void => {
        if (finished) return;
        for (const target of targets) sendPitch(target.storeId, fallbackPitch(target.store, target.selectionReason), "fallback");
        send({ type: "done" });
        finished = true;
        if (readerGone) return;
        try {
          controller.close();
        } catch {
          // 読み手が先に閉じていた。閉じる相手が無いだけなので捨てる
        }
      };

      send({ type: "init", fetchId: result.fetchId, items: result.items });

      // 紹介文の口が無い場面（受け入れ検査）・その日の AI の予算が尽きた日・もう切断されていた要求は、
      // AI の層ごと走らせず、その場で書き切って閉じる
      if (!pitchAllowed || clientGone.signal.aborted) {
        finish();
        return;
      }
      // 切断の合図が鳴ったら、読み手が残っていれば決まった文で閉じる（画面に穴を残さない）
      clientGone.signal.addEventListener("abort", finish, { once: true });

      const jobs = targets.map(async (target: PitchTarget, index: number) => {
        if (index > 0) await deps.clock.after(index * PITCH_STAGGER_MS);
        if (finished || clientGone.signal.aborted) return;
        const pitch = await writePitch(deps, { fetchId: result.fetchId, party: input.party, genres: [...(input.genres ?? [])], budgetMax: input.budgetMax ?? null, target, signal: clientGone.signal });
        sendPitch(pitch.storeId, pitch.reason, pitch.source);
      });
      const settled = Promise.allSettled(jobs);
      // 応答を閉じたあとも、紹介文の仕事（AI の呼び出しと記録）を最後まで生かしておく（設計-17）
      deps.defer?.(settled);

      void Promise.race([settled, budget]).then(finish);
    },
    // 読み手が閉じた（客が画面を閉じた・前の検索を止めた）。書きかけの紹介文の AI を止める（設計-18）
    cancel: () => {
      readerGone = true;
      clientGone.abort();
    },
  });

  return { ok: true, stream };
};
