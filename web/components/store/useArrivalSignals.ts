"use client";

// 「向かっている客」の一覧の変化を、店が気づける合図に変える（2026-09-25 監査の指摘 店-07・横断-08）。
//
//   新しい客   … 音（鳴らせなければ振動）・カードを数秒目立たせる・タブのタイトルに件数（画面に触れるまで）
//   人数の変更 … その行に「人数が変わりました 2→4 名」の印（最初に見た人数から変わっている間）・音
//   客の取り消し … 前の回に確保中（か遅れている）だった行が「客が取り消しました」になった。音・カードを数秒目立たせる
//                 （横断-08 のレビュー。それまでは確保中のカードが済んだぶんへ黙って移り、音も鳴らなかった）
// 取り直すたびに、前に見た一覧と比べる。**初めの読み込みでは鳴らさない**（開いた瞬間に全員ぶん鳴るのを避ける）。
// 比べ方（どれが新しく、どれを客が取り消し、どれの人数が変わったか）は `diffArrivals` が持つ（副作用なし）。

import { useCallback, useEffect, useRef, useState } from "react";
import type { ArrivalDto } from "../../lib/client/api";
import { playNotifyBeep } from "./beep";

/** 新しい客のカードを目立たせる長さ（AI判断。置いたままの画面を見に来る間に消えない程度） */
export const NEW_HIGHLIGHT_MS = 10_000;
/** 鳴らせない端末で代わりに震わせる形（ミリ秒・震える／止まる／震える） */
const VIBRATE_PATTERN = [200, 100, 200];

export type PartyChange = { from: number; to: number };

/** 前に見た一覧の覚え（どの確保を見たか・まだ来る客だった確保・最初に見た人数） */
export type ArrivalMemory = { seen: ReadonlySet<string>; coming: ReadonlySet<string>; firstParty: ReadonlyMap<string, number> } | null;

/** まだ来る客（確保中・期限切れで完了にできる）。人数の変更を追うのはこの行だけ */
const isComing = (row: ArrivalDto): boolean => row.kind === "active" || row.kind === "expired";

/**
 * 前の覚えと今の一覧を比べる（副作用なし）。初めて（覚えが null）なら何も新しくない。
 * 新しい客は、前に無かった確保中の行。人数の変更は、最初に見た人数と今の人数が違う行。
 * 客の取り消しは、前の回にまだ来る客だった行が、今は「客が取り消した」の行になったもの（横断-08 のレビュー）。
 */
export const diffArrivals = (
  memory: ArrivalMemory,
  rows: readonly ArrivalDto[],
): { memory: NonNullable<ArrivalMemory>; newIds: string[]; cancelledIds: string[]; partyChanges: Map<string, PartyChange> } => {
  const coming = rows.filter(isComing);
  const firstParty = new Map<string, number>(coming.map((row) => [row.reservationId, memory?.firstParty.get(row.reservationId) ?? row.party]));
  const partyChanges = new Map<string, PartyChange>(
    coming.flatMap((row) => {
      const from = firstParty.get(row.reservationId) ?? row.party;
      return from === row.party ? [] : [[row.reservationId, { from, to: row.party }] as const];
    }),
  );
  const idsWhere = (test: (row: ArrivalDto) => boolean): string[] => (memory === null ? [] : rows.filter(test).map((row) => row.reservationId));
  const newIds = idsWhere((row) => row.kind === "active" && !memory?.seen.has(row.reservationId));
  const cancelledIds = idsWhere((row) => row.kind === "customer_cancelled" && memory?.coming.has(row.reservationId) === true);
  const nextMemory = { seen: new Set(rows.map((row) => row.reservationId)), coming: new Set(coming.map((row) => row.reservationId)), firstParty };
  return { memory: nextMemory, newIds, cancelledIds, partyChanges };
};

/** 音で知らせる。鳴らせなければ震わせる（震わせる口の無い端末では何もしない） */
const alertStore = () => {
  if (playNotifyBeep()) return;
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(VIBRATE_PATTERN);
};

export type ArrivalSignals = {
  /** 目立たせている新しい客の確保の番号 */
  newIds: ReadonlySet<string>;
  /** 目立たせている、今しがた客が取り消した確保の番号（横断-08 のレビュー） */
  cancelledIds: ReadonlySet<string>;
  /** 人数が変わった行 */
  partyChanges: ReadonlyMap<string, PartyChange>;
  /** 取り直した一覧を受け取るたびに呼ぶ */
  absorb: (rows: readonly ArrivalDto[]) => void;
};

/** 数秒だけ目立たせる番号の組（足した番号は NEW_HIGHLIGHT_MS のあとで外す）。 */
const useFlashIds = () => {
  const [ids, setIds] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const flash = useCallback((added: readonly string[]) => {
    if (added.length === 0) return;
    setIds((prev) => new Set([...prev, ...added]));
    const timer = setTimeout(() => {
      setIds((prev) => new Set([...prev].filter((id) => !added.includes(id))));
    }, NEW_HIGHLIGHT_MS);
    timers.current = [...timers.current, timer];
  }, []);
  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer);
    },
    [],
  );
  return { ids, flash };
};

/**
 * タブのタイトルに、まだ見ていない新しい客の数を足す。**戻すのは自分が付けたタイトルのままのときだけ**
 * （店-07 のレビュー: それまでは画面を離れるときに、件数を付けていなくても最初に覚えたタイトルへ書き戻し、
 * 先に入った次の画面のタイトルを上書きすることがあった）。
 */
const useUnseenTitle = (unseen: number) => {
  /** 件数を付ける前のタイトルと、付けた文字列（付けていなければ null） */
  const applied = useRef<{ base: string; title: string } | null>(null);
  const restore = useCallback(() => {
    if (applied.current !== null && document.title === applied.current.title) document.title = applied.current.base;
    applied.current = null;
  }, []);

  useEffect(() => {
    if (unseen === 0) {
      restore();
      return;
    }
    // 自分の付けたタイトルのままなら、その前のタイトルに件数を付け直す（ほかが入れ替えていれば、それを元にする）
    const base = applied.current !== null && document.title === applied.current.title ? applied.current.base : document.title;
    const title = `(${unseen}) ${base}`;
    document.title = title;
    applied.current = { base, title };
  }, [unseen, restore]);

  useEffect(() => restore, [restore]);
};

export const useArrivalSignals = (): ArrivalSignals => {
  const memory = useRef<ArrivalMemory>(null);
  const { ids: newIds, flash: flashNew } = useFlashIds();
  const { ids: cancelledIds, flash: flashCancelled } = useFlashIds();
  const [partyChanges, setPartyChanges] = useState<ReadonlyMap<string, PartyChange>>(new Map());
  const [unseen, setUnseen] = useState(0);

  /** 前の回に印を付けた人数の変更（同じ変更で2度鳴らさない） */
  const lastChanges = useRef<ReadonlyMap<string, PartyChange>>(new Map());

  const absorb = useCallback(
    (rows: readonly ArrivalDto[]) => {
      const diff = diffArrivals(memory.current, rows);
      memory.current = diff.memory;
      const partyChangedNow = [...diff.partyChanges].some(([id, change]) => lastChanges.current.get(id)?.to !== change.to);
      lastChanges.current = diff.partyChanges;
      setPartyChanges(diff.partyChanges);
      if (diff.newIds.length > 0 || diff.cancelledIds.length > 0 || partyChangedNow) alertStore();
      flashCancelled(diff.cancelledIds);
      if (diff.newIds.length === 0) return;
      setUnseen((count) => count + diff.newIds.length);
      flashNew(diff.newIds);
    },
    [flashNew, flashCancelled],
  );

  useUnseenTitle(unseen);

  // 画面に触れたら、新しい客を見たとみなしてタイトルの件数を外す
  useEffect(() => {
    const seen = () => setUnseen(0);
    document.addEventListener("pointerdown", seen);
    document.addEventListener("keydown", seen);
    return () => {
      document.removeEventListener("pointerdown", seen);
      document.removeEventListener("keydown", seen);
    };
  }, []);

  return { newIds, cancelledIds, partyChanges, absorb };
};
