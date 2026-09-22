"use client";

// 打ちかけの文字から場所の候補を取る（入口 GET /api/customer/place-suggest・2026-09-22 の本人の指摘
// 「入力中の文字列から Enter を押さなくても文字列に紐づいた候補が即座に出るようにしたい」）。
//
// 決めが4つ:
//   1. 打つ手が止まってから `PLACE_SUGGEST_DEBOUNCE_MS` 待って呼ぶ（打鍵ごとに呼ばない）
//   2. `PLACE_SUGGEST_MIN_CHARS` 未満では呼ばない
//   3. 古い答えが新しい答えを上書きしない——**どの文字への答えか**を一緒に持ち、今の文字と一致する
//      ときだけ候補として返す（`components/customer/StoreImage` の「どの URL の答えか」と同じ手。
//      効果の中で同期的に状態を捨てないので lint `react-hooks/set-state-in-effect` に掛からない）
//   4. 候補は補助——入口が無い・断られた・通信が失敗した、のどれも「候補なし」に倒す
//
// 画面が fetch を直接呼ばない（基準 29.4）ため、呼び出しは `client/api` の `apiCall` を経由する。

import { useEffect, useState } from "react";
import { PLACE_SUGGEST_DEBOUNCE_MS, PLACE_SUGGEST_MAX, PLACE_SUGGEST_MIN_CHARS } from "../schemas/limits";
import { apiCall, isFailure } from "./api";

/** 応答の `suggestions` を文字の配列として読む（形は検査していないので在ることに頼らない） */
const readSuggestions = (answer: unknown): string[] => {
  if (isFailure(answer)) return [];
  const raw = (answer as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(raw)) return [];
  return raw.filter((s): s is string => typeof s === "string" && s !== "").slice(0, PLACE_SUGGEST_MAX);
};

/**
 * 今の文字に対する候補（最大 `PLACE_SUGGEST_MAX` 件）。文字が短い・まだ答えが無い・答えが古い、のどれも空。
 * `enabled` を false にすると聞きに行かない（現在地の地名が自動で入っている間など、客が打っていないとき）。
 */
export const usePlaceSuggestions = (text: string, enabled = true): string[] => {
  const query = text.trim();
  const [answered, setAnswered] = useState<{ query: string; suggestions: string[] }>({ query: "", suggestions: [] });

  useEffect(() => {
    if (!enabled || query.length < PLACE_SUGGEST_MIN_CHARS) return;
    let alive = true;
    const timer = setTimeout(() => {
      void (async () => {
        const answer = await apiCall("GET", `/api/customer/place-suggest?q=${encodeURIComponent(query)}`);
        if (!alive) return;
        setAnswered({ query, suggestions: readSuggestions(answer) });
      })();
    }, PLACE_SUGGEST_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, enabled]);

  if (!enabled || query.length < PLACE_SUGGEST_MIN_CHARS) return [];
  return answered.query === query ? answered.suggestions : [];
};
