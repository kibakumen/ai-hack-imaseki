"use client";

// 声で条件を入れるボタン（2026-09-25 監査の指摘 客-16 の案A）。本人の第1回の指摘:
//   「必要入力事項の専用記入欄とは別に先頭にワンタップで音声によってこれらの情報を歩きながら入力できるようにしたい。
//     基本的にはポチポチ入力事項を埋めなくてもいい利便性向上のため」
//
// 押すと1回だけ聞き（`client/speech`）、聞き取った文から人数・予算の上限・ジャンルを決まった規則で読んで
// （`client/voiceConditions`）欄へ入れる。欄はそのまま残るので、違っていれば手で直せる。探すのは客が押したとき
// （聞き取っただけでは探さない）。声で聞けないブラウザでは部品ごと出さない。

import { useEffect, useRef, useState } from "react";
import { listenOnce, speechAvailable } from "../../lib/client/speech";
import { parseSpokenConditions, type SpokenConditions } from "../../lib/client/voiceConditions";

type VoiceState =
  | { kind: "idle" }
  | { kind: "listening" }
  | { kind: "applied"; text: string; summary: string }
  | { kind: "unread"; text: string }
  | { kind: "denied" }
  | { kind: "failed" };

/** 入れた内容を1行で（「4名・〜3,000円・居酒屋」）。 */
const summarize = (conditions: SpokenConditions): string => {
  const parts = [
    conditions.party === undefined ? null : `${conditions.party}名`,
    conditions.budgetMax === undefined ? null : conditions.budgetMax === null ? "予算の指定なし" : `〜${conditions.budgetMax.toLocaleString("ja-JP")}円`,
    ...(conditions.genres ?? []),
  ];
  return parts.filter((part): part is string => part !== null).join("・");
};

const statusText = (state: VoiceState): string | null => {
  if (state.kind === "listening") return "聞いています…「4人で居酒屋、予算3000円」のように話してください。";
  if (state.kind === "applied") return `「${state.text}」→ ${state.summary} を入れました。違っていれば下で直せます。`;
  if (state.kind === "unread") return `「${state.text}」から人数・予算・ジャンルを読み取れませんでした。下の欄で入れてください。`;
  if (state.kind === "denied") return "マイクの利用が許可されていません。下の欄で入れてください。";
  if (state.kind === "failed") return "うまく聞き取れませんでした。もう一度押すか、下の欄で入れてください。";
  return null;
};

type VoiceInputProps = {
  /** 読み取れた条件を欄へ入れる（読めなかった項目は渡さない） */
  onApply: (conditions: SpokenConditions) => void;
};

export const VoiceInput = ({ onApply }: VoiceInputProps) => {
  const [available] = useState(speechAvailable);
  const [state, setState] = useState<VoiceState>({ kind: "idle" });
  const stopRef = useRef<(() => void) | null>(null);

  // 画面を離れたら聞くのをやめる
  useEffect(() => () => stopRef.current?.(), []);

  if (!available) return null;

  const listen = () => {
    stopRef.current?.();
    setState({ kind: "listening" });
    stopRef.current = listenOnce((outcome) => {
      stopRef.current = null;
      if (outcome.kind !== "heard") {
        setState({ kind: outcome.kind });
        return;
      }
      const conditions = parseSpokenConditions(outcome.text);
      const summary = summarize(conditions);
      if (summary === "") {
        setState({ kind: "unread", text: outcome.text });
        return;
      }
      onApply(conditions);
      setState({ kind: "applied", text: outcome.text, summary });
    });
  };

  const text = statusText(state);
  return (
    <div className="voice-input">
      <button type="button" className="voice-input__button" data-testid="btn-voice" disabled={state.kind === "listening"} onClick={listen}>
        <span aria-hidden>🎤</span> {state.kind === "listening" ? "聞いています…" : "声で入れる"}
      </button>
      <p className="voice-input__note">押すと、声がブラウザの音声認識（Chrome なら Google）へ送られて文字になります。</p>
      {text === null ? null : (
        <p className="voice-input__status" role="status" data-testid="voice-status">
          {text}
        </p>
      )}
    </div>
  );
};
