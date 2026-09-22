// 打ちかけの文字から場所の候補を出す手続き（読むだけ・入口 GET /api/customer/place-suggest）。
// 2026-09-22 本人の指摘「場所入力欄に渋谷駅などを打っても候補がでません。入力中の文字列から
// Enter を押さなくても文字列に紐づいた候補が即座に出るようにしたい」に応えたもの。
//
// 打ち切りは地図と同じ3秒（GEOCODE_TIMEOUT_MS）で、差し替えた時計と AbortSignal の両方で数える
// （usecases/placeLabel と同じ置き方・raceDeadline の注）。
//
// ⚠️ **候補は入力の補助**——取れなくても空の候補を返すだけで断りにしない（客は今までどおり文字を打って
// 探せる）。この口を持たない差し替え（受け入れ検査の偽物）では外へ聞かずに空へ倒す
// （geocoder.reverse を持たない場面と同じ考え）。
//
// どの経路で取れたか（Places か Geocoding か）は**記録にだけ**残す（客には見せない）。
// 打った文字そのものは場所を示す個人データなので記録に載せない（要件27の基準 27.5 の考え）。

import type { Deps } from "../ports";
import { GEOCODE_TIMEOUT_MS, PLACE_SUGGEST_MAX } from "../schemas/limits";
import type { PlaceSuggestQuery } from "../schemas/placeSuggest";
import { raceDeadline } from "./deadline";

export type PlaceSuggestResult = { suggestions: string[] };

export const placeSuggest = async (deps: Deps, input: PlaceSuggestQuery): Promise<PlaceSuggestResult> => {
  const suggest = deps.geocoder.suggest;
  if (!suggest) return { suggestions: [] };

  // 打ち切りの合図は、最初の await より前に作る（raceDeadline の注）。
  const deadline = deps.clock.after(GEOCODE_TIMEOUT_MS);
  const startedAt = deps.clock.now().getTime();
  const answer = await raceDeadline(GEOCODE_TIMEOUT_MS, deadline, (signal) => suggest.call(deps.geocoder, input.q, { signal }));
  const durationMs = deps.clock.now().getTime() - startedAt;
  if (!answer.ok || !answer.value.ok) {
    deps.logger.log({ event: "place_suggest", durationMs, errorKind: "unavailable" });
    return { suggestions: [] };
  }
  // 経路の名前は閉じた2語（`places`／`geocoding`）。文字ではなく経路だけを記録する。
  deps.logger.log({ event: `place_suggest.${answer.value.source}`, durationMs });
  return { suggestions: answer.value.suggestions.slice(0, PLACE_SUGGEST_MAX) };
};
