"use client";

// 押したあとの手応えと、二重送信の止め（2026-09-25 監査の指摘 横断-03）。全画面の「送る」操作はこの1つを使う。
//
// それまで送っている間にボタンを止めていたのは「今すぐ探す」と公開中のカードの「更新する」だけで、ほかの操作は
// 送っている間も押せ、見た目も変わらなかった（クーポンの「作る」を2回押すと2枚でき、通報は同じものが重ねて届いた）。
//   - 送っている間は `busy` が立ち、もう1度 `run` を呼んでも送らない（連打しても1回）
//   - 断りは `failure` に残す（欄の直下・操作の直下に出すのは InputRefusal）
//   - 済んだら `done` に1文を置く（DoneNotice が role=status で出す）
// 操作ごとに別に持つ（1つの画面に操作が複数あっても、ある操作の断りがほかの操作の下に出ない）。
// 状態の更新は次の描画まで見えないので、同じ瞬間の2度押しは ref で止める。

import { useCallback, useRef, useState } from "react";
import { isFailure, type ApiFailure } from "../../lib/client/api";

/** 済んだときの1文。応答から作るときは関数で渡す（null なら出さない）。 */
export type DoneText<T> = string | ((result: T) => string | null);

export type Submit = {
  /** 送っている間 true。ボタンを止め、文言を「送っています…」に替える（SubmitButton） */
  busy: boolean;
  /** 最後に返った断り（通れば null） */
  failure: ApiFailure | null;
  /** 済んだことを伝える1文（DoneNotice が出す）。送り始めたら消える */
  done: string | null;
  /**
   * 送る。応答（通った本文か断り）をそのまま返す。送っている途中にもう1度呼ばれたら、送らずに null を返す。
   * 通ったら `doneText` を `done` に置く。
   */
  run: <T>(send: () => Promise<T | ApiFailure>, doneText?: DoneText<T>) => Promise<T | ApiFailure | null>;
  /** 断りと済んだ知らせを消す（「やめる」を押したとき・書き直し始めたとき） */
  clear: () => void;
};

export const useSubmit = (): Submit => {
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const sending = useRef(false);

  const run = useCallback(async <T>(send: () => Promise<T | ApiFailure>, doneText?: DoneText<T>): Promise<T | ApiFailure | null> => {
    if (sending.current) return null;
    sending.current = true;
    setBusy(true);
    setDone(null);
    try {
      const result = await send();
      if (isFailure(result)) {
        setFailure(result);
        return result;
      }
      setFailure(null);
      if (doneText !== undefined) setDone(typeof doneText === "function" ? doneText(result as T) : doneText);
      return result;
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }, []);

  const clear = useCallback(() => {
    setFailure(null);
    setDone(null);
  }, []);

  return { failure, busy, done, run, clear };
};
