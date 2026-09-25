// ブラウザの音声認識（Web Speech API）を1回だけ聞く小さな口（2026-09-25 監査の指摘 客-16 の案A）。
//
// ⚠️ **声は端末の外へ出る**: Chrome の音声認識は声を Google のサーバーへ送って文字にする。だから聞くのは
// 客がボタンを押したときだけで、開いた瞬間には聞かない。送信先は /privacy の表に載せてある。
// 使えないブラウザ（Firefox・一部の Safari）では部品ごと出さない（`speechAvailable`）。

/** ブラウザの音声認識の、この口が使う分だけの形（TypeScript の DOM の型には入っていない）。 */
type RecognitionResultEvent = { results: ArrayLike<ArrayLike<{ transcript: string }>> };
type Recognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
};
type RecognitionConstructor = new () => Recognition;

const recognitionConstructor = (): RecognitionConstructor | null => {
  if (typeof window === "undefined") return null;
  const found = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return found.SpeechRecognition ?? found.webkitSpeechRecognition ?? null;
};

/** このブラウザで声を聞けるか。 */
export const speechAvailable = (): boolean => recognitionConstructor() !== null;

/** 聞き取りが終わったときの結果。`denied` はマイクの許可を断られた、`failed` はそれ以外で聞き取れなかった。 */
export type SpeechOutcome = { kind: "heard"; text: string } | { kind: "denied" } | { kind: "failed" };

const DENIED_ERRORS = ["not-allowed", "service-not-allowed"];

/**
 * 1回だけ聞く（日本語・言い終わったら止まる）。返す関数を呼ぶと、聞くのをやめる（画面を離れたとき）。
 * 結果は `onDone` に1回だけ渡す。
 */
export const listenOnce = (onDone: (outcome: SpeechOutcome) => void): (() => void) => {
  const Constructor = recognitionConstructor();
  if (Constructor === null) {
    onDone({ kind: "failed" });
    return () => {};
  }
  const recognition = new Constructor();
  recognition.lang = "ja-JP";
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.continuous = false;
  let settled = false;
  const finish = (outcome: SpeechOutcome) => {
    if (settled) return;
    settled = true;
    onDone(outcome);
  };
  recognition.onresult = (event) => {
    const text = Array.from(event.results)
      .map((result) => result[0]?.transcript ?? "")
      .join("")
      .trim();
    finish(text === "" ? { kind: "failed" } : { kind: "heard", text });
  };
  recognition.onerror = (event) => finish(DENIED_ERRORS.includes(event.error ?? "") ? { kind: "denied" } : { kind: "failed" });
  recognition.onend = () => finish({ kind: "failed" });
  try {
    recognition.start();
  } catch {
    finish({ kind: "failed" });
  }
  return () => {
    settled = true;
    recognition.abort();
  };
};
