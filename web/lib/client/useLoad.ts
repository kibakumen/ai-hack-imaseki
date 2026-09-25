// 読み込みの状態を4つで扱う（2026-09-25 監査の指摘 横断-01）。
//
//   loading … まだ1度も返っていない
//   failed  … 1度も取れていないまま断られた・通信に失敗した（**0件と区別する**）
//   empty   … 取れて、中身が0件だった
//   ready   … 取れて、中身がある
//
// それまで画面ごとに「失敗したら空の配列」「失敗したら null で空の main」と倒し方がばらばらで、
// 読めなかったのか0件なのかが画面から分からなかった（運営の通報の一覧は 401 でも「通報はまだありません」）。
//
// 取れたあとの取り直し（開きっぱなしの画面の定期の取り直し・操作のあとの取り直し）が失敗したときは、
// 前の中身を残したまま `refreshFailure` を立てる——一覧が空に落ちて向かっている客が消えるのを避けつつ、
// 「更新できていない」ことは画面に出せるようにする（「最終更新 HH:MM・更新できていません」の帯）。
//
// 送る順と映す順（2026-09-25 監査の指摘 不具合-17 とそのレビュー）:
//   - 定期の取り直しは、前の回が返るまで次を送らない。返らないまま止まった回だけ、間隔の2回ぶんで見切る
//     （客の側の `usePolling` と同じ決め）。
//   - 読み直し（開いた時・操作のあと）は待たずにすぐ送り、それより前に送った回の答えは捨てる。
//   - 定期の回同士は、新しい答えを映したあとに届いた古い答えだけを捨てる（遅れて届いた答えは映す）。

import { useCallback, useEffect, useRef, useState } from "react";
import { isFailure, type ApiFailure } from "./api";
import { STUCK_INTERVALS } from "./usePolling";

export type LoadState<T> =
  | { status: "loading" }
  | { status: "failed"; failure: ApiFailure }
  | {
      status: "empty" | "ready";
      data: T;
      /** 最後に取れた時刻（ミリ秒） */
      updatedAt: number;
      /** 取れたあとの取り直しが失敗している間だけ立つ。次に取れれば消える */
      refreshFailure: ApiFailure | null;
    };

export type UseLoadOptions<T> = {
  /** 中身が0件か。渡さなければ empty にはならない（ホームのように「0件」が無い読み込み） */
  isEmpty?: (data: T) => boolean;
  /** 取れたたびに1回呼ぶ（音を鳴らす・点を足すなど、受け取った時に済ませたいこと） */
  onLoaded?: (data: T) => void;
  /**
   * 定期の取り直しの間隔（ミリ秒）。渡さなければ開いた時の1回だけ。渡したときは、画面に戻ったときにもすぐ1回
   * 取り直す（店-08）。画面が隠れている間も止めない
   */
  pollMs?: number;
};

/** 送った回が読み直し（開いた時・操作のあと）か、定期の取り直しか */
type RequestKind = "reload" | "poll";

/** 前の状態と今回の結果から、次の状態を決める（純粋）。 */
export const nextLoadState = <T>(prev: LoadState<T>, result: T | ApiFailure, now: number, isEmpty?: (data: T) => boolean): LoadState<T> => {
  if (isFailure(result)) {
    if (prev.status === "ready" || prev.status === "empty") return { ...prev, refreshFailure: result };
    return { status: "failed", failure: result };
  }
  return { status: isEmpty?.(result) ? "empty" : "ready", data: result, updatedAt: now, refreshFailure: null };
};

/**
 * 読み込みの状態を持つ。`load` は**安定した関数**（モジュールの関数か useCallback）を渡す
 * ——`load` が変わったら（詳細の画面で別の店へ移った、など）状態を loading に戻して読み直す。
 * 前の `load` の答えが後から返ってきても捨てる（別の店の中身を出さない）。
 */
export const useLoad = <T>(load: () => Promise<T | ApiFailure>, options: UseLoadOptions<T> = {}): { state: LoadState<T>; reload: () => Promise<void> } => {
  const [state, setState] = useState<LoadState<T>>({ status: "loading" });
  // `load` が変わったら、描く途中で loading へ戻す（React の「前の値を覚えて描く途中で直す」形。
  // 効果の中で状態を戻すと、1度古い中身で描いてから戻ることになる）。
  const [loadedWith, setLoadedWith] = useState(() => load);
  if (loadedWith !== load) {
    setLoadedWith(() => load);
    setState({ status: "loading" });
  }
  // いちばん新しい `load` と `options` を使う（古い値を掴んだまま呼ばない）。
  const latest = useRef({ load, options });
  useEffect(() => {
    latest.current = { load, options };
  });
  /** 何回目の読み込みの系列か。`load` が変わるたびに進め、前の系列の答えを捨てる */
  const generation = useRef(0);
  /** 送った回の通し番号（1から） */
  const requestSeq = useRef(0);
  /**
   * いちばん新しい読み直し（開いた時・操作のあと）の番号。これより前に送った回の答えは、後から届いても捨てる
   * （2026-09-25 監査の指摘 不具合-17）。店のホームでは、「完了」のあとの読み直しより先に送った定期の取り直し
   * （押す前の一覧）が後から届き、完了にした行が確保中に戻って「新しい客」の音まで鳴っていた。
   */
  const reloadSeq = useRef(0);
  /**
   * 画面へ映した回の番号。これより前に送った回の答えは捨てる（追い越された古い答えで戻さない）。
   * **定期の回同士は、送った順ではなく映した順で比べる**（不具合-17 のレビュー）——以前は「あとから送った回が
   * あれば捨てる」だったので、応答が毎回間隔より遅い回線では、どの答えも次の定期の回に追い越されて捨てられ、
   * 一覧が黙って固まり、失敗の帯（横断-01）も出なかった。
   */
  const appliedSeq = useRef(0);
  /** 送って答えをまだ受け取っていない、いちばん新しい回を送った時刻（無ければ null） */
  const inFlightSince = useRef<number | null>(null);
  const mounted = useRef(false);

  const send = useCallback(async (kind: RequestKind): Promise<void> => {
    const mine = generation.current;
    requestSeq.current += 1;
    const seq = requestSeq.current;
    if (kind === "reload") reloadSeq.current = seq;
    inFlightSince.current = Date.now();
    let result: T | ApiFailure;
    try {
      result = await latest.current.load();
    } finally {
      // 見切られた古い回は、あとから送った回の「送っている最中」を解かない
      if (requestSeq.current === seq) inFlightSince.current = null;
    }
    // 画面を離れたあと・別のものを読み始めたあと・あとの読み直しを送ったあと・新しい答えを映したあとに届いた答えは捨てる。
    if (!mounted.current || mine !== generation.current || seq < reloadSeq.current || seq <= appliedSeq.current) return;
    appliedSeq.current = seq;
    if (!isFailure(result)) latest.current.options.onLoaded?.(result);
    setState((prev) => nextLoadState(prev, result, Date.now(), latest.current.options.isEmpty));
  }, []);

  /** 読み直し（開いた時・操作のあと・「もう一度読み込む」）。前の回を待たずにすぐ送る */
  const reload = useCallback(() => send("reload"), [send]);

  useEffect(() => {
    mounted.current = true;
    latest.current = { ...latest.current, load };
    generation.current += 1;
    void reload();
    return () => {
      mounted.current = false;
    };
  }, [load, reload]);

  const pollMs = options.pollMs;
  useEffect(() => {
    if (!pollMs) return;
    const tick = () => {
      // 前の回がまだ返っていなければ送らない。返らないまま止まった回だけ、間隔の2回ぶんで見切る（usePolling と同じ決め）
      const since = inFlightSince.current;
      if (since !== null && Date.now() - since < pollMs * STUCK_INTERVALS) return;
      void send("poll");
    };
    const timer = setInterval(tick, pollMs);
    // 画面に戻ったら、間隔を待たずにすぐ1回取り直す（2026-09-25 監査の指摘 店-08。客の側の usePolling と同じ決め）。
    // 隠れている間も**止めない**——店のホームは隠れている間こそ新しい客の音が要る（usePolling はここが違う）。
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [send, pollMs]);

  return { state, reload };
};
