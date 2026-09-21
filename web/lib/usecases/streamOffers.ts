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

import type { Deps } from "../ports";
import { fallbackPitch } from "../domain/pitch";
import type { FetchInput } from "../schemas/fetch";
import { fetchOffers, type FetchOffersResult, type FetchResultItem } from "./fetchOffers";
import { writePitch, type PitchSource, type PitchTarget } from "./writePitch";

/** ストリーム全体の上限（値は AI判断・速成版と同じ25秒） */
const STREAM_BUDGET_MS = 25000;
/** 着手を少しずつずらす幅（近い店から先に着手する。全部並行に進めてよい） */
const PITCH_STAGGER_MS = 150;

export type StreamLine =
  | { type: "init"; fetchId: string; items: FetchResultItem[] }
  | { type: "pitch"; storeId: string; reason: string; source: PitchSource }
  | { type: "done" };

export type StreamOffersResult = { ok: true; stream: ReadableStream<Uint8Array> } | Extract<FetchOffersResult, { ok: false }>;

/** NDJSON（1行1つの JSON）の見出し。改行で区切るので、客の側は1行ずつ読める。 */
export const NDJSON_CONTENT_TYPE = "application/x-ndjson; charset=utf-8";

export const buildOffersStream = async (deps: Deps, customerId: string, input: FetchInput): Promise<StreamOffersResult> => {
  const result = await fetchOffers(deps, customerId, input);
  if (!result.ok) return result;

  const encoder = new TextEncoder();
  // 蓋の合図は、最初の紹介文を頼むより前に作る（差し替えた時計は、進めたあとに作った合図を鳴らさない）
  const budget = deps.clock.after(STREAM_BUDGET_MS);
  const targets = [...result.pitchTargets];

  const stream = new ReadableStream<Uint8Array>({
    start: (controller) => {
      // 1店につき紹介文は1行だけ。締め切りのあとに戻ってきた文は捨てる。
      const written = new Set<string>();
      let closed = false;

      const send = (line: StreamLine): void => {
        if (closed) return;
        controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
      };
      const sendPitch = (storeId: string, reason: string, source: PitchSource): void => {
        if (closed || written.has(storeId)) return;
        written.add(storeId);
        send({ type: "pitch", storeId, reason, source });
      };
      const finish = (): void => {
        if (closed) return;
        // 間に合わなかった店を一斉に決定論の文で確定してから閉じる
        for (const target of targets) sendPitch(target.storeId, fallbackPitch(target.store, target.selectionReason), "fallback");
        send({ type: "done" });
        closed = true;
        controller.close();
      };

      send({ type: "init", fetchId: result.fetchId, items: result.items });

      // 紹介文の口が無い場面（受け入れ検査）では AI の層ごと走らせず、その場で書き切って閉じる
      if (!deps.pitch || targets.length === 0) {
        finish();
        return;
      }

      const jobs = targets.map(async (target: PitchTarget, index: number) => {
        if (index > 0) await deps.clock.after(index * PITCH_STAGGER_MS);
        if (closed) return;
        const pitch = await writePitch(deps, { fetchId: result.fetchId, party: input.party, genres: [...(input.genres ?? [])], budgetMax: input.budgetMax ?? null, target });
        sendPitch(pitch.storeId, pitch.reason, pitch.source);
      });

      void Promise.race([Promise.allSettled(jobs), budget]).then(finish);
    },
  });

  return { ok: true, stream };
};
