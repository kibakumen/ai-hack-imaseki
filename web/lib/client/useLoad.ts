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

import { useCallback, useEffect, useRef, useState } from "react";
import { isFailure, type ApiFailure } from "./api";

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
  /** 定期の取り直しの間隔（ミリ秒）。渡さなければ開いた時の1回だけ */
  pollMs?: number;
};

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
  const mounted = useRef(false);

  const reload = useCallback(async () => {
    const mine = generation.current;
    const result = await latest.current.load();
    // 画面を離れたあと・別のものを読み始めたあとに返ってきた答えは捨てる。
    if (!mounted.current || mine !== generation.current) return;
    if (!isFailure(result)) latest.current.options.onLoaded?.(result);
    setState((prev) => nextLoadState(prev, result, Date.now(), latest.current.options.isEmpty));
  }, []);

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
    const timer = setInterval(() => {
      void reload();
    }, pollMs);
    return () => clearInterval(timer);
  }, [reload, pollMs]);

  return { state, reload };
};
