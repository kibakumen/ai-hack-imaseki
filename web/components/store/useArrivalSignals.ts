"use client";

// 「向かっている客」の一覧の変化を、店が気づける合図に変える（2026-09-25 監査の指摘 店-07・横断-08）。
//
//   新しい客   … 音（鳴らせなければ振動）・カードを数秒目立たせる・タブのタイトルに件数（画面に触れるまで）
//   人数の変更 … その行に「人数が変わりました 2→4 名」の印（最初に見た人数から変わっている間）・音
// 取り直すたびに、前に見た一覧と比べる。**初めの読み込みでは鳴らさない**（開いた瞬間に全員ぶん鳴るのを避ける）。
// 比べ方（どれが新しく、どれの人数が変わったか）は `diffArrivals` が持つ（副作用なし）。

import { useCallback, useEffect, useRef, useState } from "react";
import type { ArrivalDto } from "../../lib/client/api";
import { playNotifyBeep } from "./beep";

/** 新しい客のカードを目立たせる長さ（AI判断。置いたままの画面を見に来る間に消えない程度） */
export const NEW_HIGHLIGHT_MS = 10_000;
/** 鳴らせない端末で代わりに震わせる形（ミリ秒・震える／止まる／震える） */
const VIBRATE_PATTERN = [200, 100, 200];

export type PartyChange = { from: number; to: number };

/** 前に見た一覧の覚え（どの確保を見たか・最初に見た人数） */
export type ArrivalMemory = { seen: ReadonlySet<string>; firstParty: ReadonlyMap<string, number> } | null;

/** まだ来る客（確保中・期限切れで完了にできる）。人数の変更を追うのはこの行だけ */
const isComing = (row: ArrivalDto): boolean => row.kind === "active" || row.kind === "expired";

/**
 * 前の覚えと今の一覧を比べる（副作用なし）。初めて（覚えが null）なら何も新しくない。
 * 新しい客は、前に無かった確保中の行。人数の変更は、最初に見た人数と今の人数が違う行。
 */
export const diffArrivals = (
  memory: ArrivalMemory,
  rows: readonly ArrivalDto[],
): { memory: NonNullable<ArrivalMemory>; newIds: string[]; partyChanges: Map<string, PartyChange> } => {
  const coming = rows.filter(isComing);
  const firstParty = new Map<string, number>(coming.map((row) => [row.reservationId, memory?.firstParty.get(row.reservationId) ?? row.party]));
  const partyChanges = new Map<string, PartyChange>(
    coming.flatMap((row) => {
      const from = firstParty.get(row.reservationId) ?? row.party;
      return from === row.party ? [] : [[row.reservationId, { from, to: row.party }] as const];
    }),
  );
  const newIds = memory === null ? [] : rows.filter((row) => row.kind === "active" && !memory.seen.has(row.reservationId)).map((row) => row.reservationId);
  return { memory: { seen: new Set(rows.map((row) => row.reservationId)), firstParty }, newIds, partyChanges };
};

/** 音で知らせる。鳴らせなければ震わせる（震わせる口の無い端末では何もしない） */
const alertStore = () => {
  if (playNotifyBeep()) return;
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(VIBRATE_PATTERN);
};

export type ArrivalSignals = {
  /** 目立たせている新しい客の確保の番号 */
  newIds: ReadonlySet<string>;
  /** 人数が変わった行 */
  partyChanges: ReadonlyMap<string, PartyChange>;
  /** 取り直した一覧を受け取るたびに呼ぶ */
  absorb: (rows: readonly ArrivalDto[]) => void;
};

export const useArrivalSignals = (): ArrivalSignals => {
  const memory = useRef<ArrivalMemory>(null);
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(new Set());
  const [partyChanges, setPartyChanges] = useState<ReadonlyMap<string, PartyChange>>(new Map());
  const [unseen, setUnseen] = useState(0);
  const baseTitle = useRef<string | null>(null);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  /** 前の回に印を付けた人数の変更（同じ変更で2度鳴らさない） */
  const lastChanges = useRef<ReadonlyMap<string, PartyChange>>(new Map());

  const absorb = useCallback((rows: readonly ArrivalDto[]) => {
    const diff = diffArrivals(memory.current, rows);
    memory.current = diff.memory;
    const partyChangedNow = [...diff.partyChanges].some(([id, change]) => lastChanges.current.get(id)?.to !== change.to);
    lastChanges.current = diff.partyChanges;
    setPartyChanges(diff.partyChanges);
    if (diff.newIds.length > 0 || partyChangedNow) alertStore();
    if (diff.newIds.length === 0) return;
    setUnseen((count) => count + diff.newIds.length);
    setNewIds((prev) => new Set([...prev, ...diff.newIds]));
    const timer = setTimeout(() => {
      setNewIds((prev) => new Set([...prev].filter((id) => !diff.newIds.includes(id))));
    }, NEW_HIGHLIGHT_MS);
    timers.current = [...timers.current, timer];
  }, []);

  // タブのタイトルに、まだ見ていない新しい客の数を足す。画面に触れたら（見たとみなして）戻す。
  useEffect(() => {
    if (baseTitle.current === null) baseTitle.current = document.title;
    document.title = unseen > 0 ? `(${unseen}) ${baseTitle.current}` : baseTitle.current;
  }, [unseen]);

  useEffect(() => {
    const seen = () => setUnseen(0);
    document.addEventListener("pointerdown", seen);
    document.addEventListener("keydown", seen);
    return () => {
      document.removeEventListener("pointerdown", seen);
      document.removeEventListener("keydown", seen);
      for (const timer of timers.current) clearTimeout(timer);
      if (baseTitle.current !== null) document.title = baseTitle.current;
    };
  }, []);

  return { newIds, partyChanges, absorb };
};
