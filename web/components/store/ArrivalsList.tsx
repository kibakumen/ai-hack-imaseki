"use client";

// 「向かっている客」の一覧（要件20）。行の中身・出す／出さない・できる操作はすべて入口が決めた値で、
// **この部品は描くだけ**（判断は `domain/storeHome` の `arrivalRows` と `domain/reservation` の
// `canComplete`）。押したときの1手だけをここが持つ:
//
//   - 完了済み（基準 20.8）… 呼び名・人数・コードを出して確かめを求め、確かめてから要求を出す
//   - 取り消し（要件21の基準 21.2・21.3）… 客に知らせが送られることと、残りの枠が戻らないことを示して確かめを求める。理由は聞かない
//   - 来ない（枠を戻す）（要件21の基準 21.8・2026-09-26 本人選択）… 客に知らせが送られることと、この組の枠が残りへ戻ることを
//     示して確かめを求め、`noShow: true` だけを送る。打つ欄は置かない（基準 21.3）
//   - 断られたとき（基準 20.20・20.21）… その確保の今の状態を、押した操作に合う文にして出し、一覧を取り直す（店-10）
//
// 置かない操作（基準 20.10・20.11・20.17）: 完了済みを元の状態にする操作・完了済みを取り消す操作・
// コードを打ち込む欄・使われたクーポンを記録する欄。**この部品に入力欄は1つも無い。**
//
// 並び（2026-09-21 の本人の指摘と 2026-09-25 の監査の指摘）:
//   - 1人1枚の横長のカード。左端に**人数の札**（呼び名から切り離して省かない・店-11）、右に完了のボタン
//   - 確保中の客 → **遅れている客**（期限切れでまだ完了にできる行。何時まで完了にできるかを出し、開いたまま・店-02）
//     → 済んだぶん（完了済み・取り消し）は畳んで下へ——**消さない**（見返せる）
//   - **客が取り消した行**（10分だけ届く）は、確保中の客と同じ開いた並びに、元の位置のまま薄く出して「客が取り消しました」の
//     印を付ける（横断-08 のレビュー。畳んだ済んだぶんに入れると、確保中のカードが黙って消えたのと店には同じに見えた）
//   - 確かめは**押したカードの中**に出し、確定のボタンへ焦点を移す。送っている間は押せない（店-01）
//   - 断られたときの文も**押したカードの中**に出す。そのカードが一覧から消えた・畳んだ済んだぶんへ移ったときだけ、
//     一覧の先頭に出す（店-01 のレビュー。一覧の最下部だと、スマホでは画面の外に出て何も起きていないように見えた）
//   - 新しく来た客・今しがた取り消した客のカードは数秒目立たせ、人数が変わった行には「2→4 名」の印を付ける
//     （店-07・横断-08。印は StoreHome が渡す）
//
// 2026-10-08 本人選択「案C 片手の親指」: 向かっている客は横に送るカードの列にし、画面の下の操作の帯のすぐ上（親指に
// いちばん近い所）に置く。1枚の形は ArrivalCard。キャンセルの2つは「⋮」の奥のシートへ離した。

import { useState } from "react";
import { callApi, isFailure, type ArrivalDto } from "../../lib/client/api";
import { ARRIVALS_TEXTS } from "../../lib/domain/texts";
import { timeInJst } from "../ui/jstTime";
import { ArrivalCard, RefusalMessage, isCustomerCancelled, isLate, type ArrivalAction, type Pending, type Refusal } from "./ArrivalCard";
import { playNotifyBeep } from "./beep";
import type { PartyChange } from "./useArrivalSignals";

/** 入口 `GET /api/store/home` の `arrivals` の1行（受け入れ検査の契約 `ArrivalRow`）。型は schemas/responses の表から（設計-07）。 */
export type ArrivalsListRow = ArrivalDto;

type Props = {
  rows: ArrivalsListRow[];
  /** 要求のあと（通っても断られても）一覧を取り直す（基準 20.21） */
  onChanged: () => void;
  /** 新しく来た客（目立たせる・店-07） */
  newIds?: ReadonlySet<string>;
  /** 今しがた客が取り消した行（目立たせる・横断-08 のレビュー） */
  cancelledIds?: ReadonlySet<string>;
  /** 人数が変わった行（横断-08 の案B） */
  partyChanges?: ReadonlyMap<string, PartyChange>;
  /** 見出しの右に出す「最終更新」と「今すぐ更新」（店-08）。渡さなければ出さない */
  updatedAt?: number | null;
  onRefresh?: () => void;
};

const ROUTE_OF = {
  complete: "POST /api/store/reservations/:id/complete",
  "store-cancel": "POST /api/store/reservations/:id/cancel",
  // 同じ入口に、来ないことの印だけを添えて送る（基準 21.8）
  "store-no-show": "POST /api/store/reservations/:id/cancel",
} as const satisfies Record<ArrivalAction, string>;

/** 操作ごとの本文。完了済みと店の都合の取り消しはコードも理由も送らない（基準 20.11・21.3） */
const BODY_OF: Record<ArrivalAction, Record<string, boolean>> = { complete: {}, "store-cancel": {}, "store-no-show": { noShow: true } };

/** 一覧の見出しの右（最終更新と今すぐ更新・店-08） */
const RefreshBar = ({ updatedAt, onRefresh }: { updatedAt: number | null | undefined; onRefresh: (() => void) | undefined }) => {
  if (!onRefresh) return null;
  return (
    <div className="store-arrivals__refresh">
      {updatedAt ? (
        <span className="store-note" data-testid="arrivals-updated">
          {ARRIVALS_TEXTS.updatedAt(timeInJst(new Date(updatedAt).toISOString()))}
        </span>
      ) : null}
      <button type="button" className="store-btn store-btn--quiet" data-testid="btn-refresh-arrivals" onClick={onRefresh}>
        {ARRIVALS_TEXTS.refresh}
      </button>
    </div>
  );
};

export const ArrivalsList = ({ rows, onChanged, newIds, cancelledIds, partyChanges, updatedAt, onRefresh }: Props) => {
  const [pending, setPending] = useState<Pending | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);

  const ask = (action: ArrivalAction, row: ArrivalsListRow) => {
    if (pending?.sending) return;
    setRefusal(null);
    setPending({ action, row, sending: false });
  };

  const send = async () => {
    if (pending === null || pending.sending) return;
    const { action, row } = pending;
    setPending({ ...pending, sending: true });
    // コードも理由の文も送らない（基準 20.11・要件21の基準 21.3）。来ないは印だけ（基準 21.8）
    const result = await callApi(ROUTE_OF[action], { params: { id: row.reservationId }, body: BODY_OF[action] });
    const refused = isFailure(result);
    setRefusal(refused ? { reservationId: row.reservationId, action, failure: result } : null);
    setPending(null);
    // 手が離せない店でも気づけるように、通った時だけ音を鳴らす（鳴らせない環境では何も起きない）
    if (!refused) playNotifyBeep();
    // 断られたときも取り直す——古い行が残っているのが断りの原因なので（基準 20.21）
    onChanged();
  };

  // 今まさに向かっている組（と、今しがた客が取り消した組・元の位置のまま薄く）を上に、遅れている組をその直下（開いたまま）、
  // 済んだ組を下に畳む。**どこにも同じ行を二重に出さない。**
  const waiting = rows.filter((row) => row.kind === "active" || isCustomerCancelled(row));
  const late = rows.filter(isLate);
  const openIds = new Set([...waiting, ...late].map((row) => row.reservationId));
  const past = rows.filter((row) => !openIds.has(row.reservationId));
  const noneComing = waiting.every(isCustomerCancelled) && late.length === 0;
  const comingCount = waiting.filter((row) => !isCustomerCancelled(row)).length;
  // 押したカードが開いた並びに残っていればその中に、消えた・畳んだ中へ移ったなら一覧の先頭に出す
  const refusalInCard = refusal !== null && openIds.has(refusal.reservationId);

  const renderCard = (row: ArrivalsListRow, done: boolean) => (
    <ArrivalCard
      key={`${row.reservationId}:${row.kind}`}
      row={row}
      done={done}
      highlighted={(newIds?.has(row.reservationId) ?? false) || (cancelledIds?.has(row.reservationId) ?? false)}
      partyChange={partyChanges?.get(row.reservationId)}
      pending={pending !== null && pending.row.reservationId === row.reservationId ? pending : null}
      refusal={refusalInCard && refusal.reservationId === row.reservationId ? refusal : null}
      onAsk={ask}
      onConfirm={() => {
        void send();
      }}
      onDismiss={() => setPending(null)}
    />
  );

  return (
    <section className="store-arrivals" data-testid="arrivals">
      <div className="store-arrivals__head">
        <h2>
          {ARRIVALS_TEXTS.heading}
          {comingCount > 0 ? <b className="store-arrivals__count"> {comingCount}組</b> : null}
        </h2>
        <RefreshBar updatedAt={updatedAt} onRefresh={onRefresh} />
      </div>

      {refusal !== null && !refusalInCard ? <RefusalMessage refusal={refusal} /> : null}

      {noneComing ? <p className="store-empty store-empty--arrivals">{ARRIVALS_TEXTS.empty}</p> : null}

      {waiting.length > 1 ? <p className="store-note store-arrivals__hint">横に送ると次の組</p> : null}
      {waiting.length > 0 ? <ul className="store-arrival-grid">{waiting.map((row) => renderCard(row, isCustomerCancelled(row)))}</ul> : null}

      {late.length > 0 ? (
        <div className="store-late" data-testid="arrivals-late">
          <h3>{ARRIVALS_TEXTS.lateHeading}</h3>
          <ul className="store-arrival-grid">{late.map((row) => renderCard(row, false))}</ul>
        </div>
      ) : null}

      {past.length > 0 ? (
        <details className="store-past">
          <summary>{ARRIVALS_TEXTS.pastHeading(past.length)}</summary>
          <ul className="store-arrival-grid store-arrival-grid--stack">{past.map((row) => renderCard(row, true))}</ul>
        </details>
      ) : null}
    </section>
  );
};

export default ArrivalsList;
