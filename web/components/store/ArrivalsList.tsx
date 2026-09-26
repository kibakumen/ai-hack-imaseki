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

import { useEffect, useRef, useState } from "react";
import { callApi, isFailure, type ApiFailure, type ArrivalDto } from "../../lib/client/api";
import { ARRIVALS_TEXTS } from "../../lib/domain/texts";
import { ARRIVAL_COMPLETE_GRACE_MS } from "../../lib/schemas/limits";
import { FormMessage } from "../ui/InputRefusal";
import { timeInJst } from "../ui/jstTime";
import { playNotifyBeep } from "./beep";
import type { PartyChange } from "./useArrivalSignals";

/** 入口 `GET /api/store/home` の `arrivals` の1行（受け入れ検査の契約 `ArrivalRow`）。型は schemas/responses の表から（設計-07）。 */
export type ArrivalsListRow = ArrivalDto;

type ArrivalAction = "complete" | "store-cancel" | "store-no-show";

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

/** 確かめの文と、確定のボタンの名前 */
const confirmTextOf = (action: ArrivalAction, row: ArrivalsListRow): string => {
  if (action === "complete") return ARRIVALS_TEXTS.confirmComplete(ARRIVALS_TEXTS.who(row.nickname), row.party, row.code);
  return action === "store-no-show" ? ARRIVALS_TEXTS.confirmNoShow : ARRIVALS_TEXTS.confirmCancel;
};
const CONFIRM_LABEL_OF: Record<ArrivalAction, string> = { complete: "完了済みにする", "store-cancel": "キャンセルする", "store-no-show": "来店なしでキャンセルする" };

/** 押したカードと操作、送っている最中か */
type Pending = { action: ArrivalAction; row: ArrivalsListRow; sending: boolean };

/** 断られた操作（どのカードの・どの操作が・どう断られたか。文は操作ごとに選ぶ・店-10） */
type Refusal = { reservationId: string; action: ArrivalAction; failure: ApiFailure };

/** 開いた並びに出す、客が取り消した行（10分だけ届く・横断-08） */
const isCustomerCancelled = (row: ArrivalsListRow): boolean => row.kind === "customer_cancelled";

/** 遅れている客の行（期限切れで、まだ完了にできる）。止められている店の期限切れは済んだぶんへ回す */
const isLate = (row: ArrivalsListRow): boolean => row.kind === "expired" && row.canComplete;

/** 期限から、完了にできる終わりの時刻（日本時間の HH:MM）。 */
const lateUntilOf = (row: ArrivalsListRow): string => timeInJst(new Date(Date.parse(row.expiresAt) + ARRIVAL_COMPLETE_GRACE_MS).toISOString());

type ConfirmProps = { pending: Pending; onConfirm: () => void; onDismiss: () => void };

/**
 * 押す前の確かめ。**押したカードの中**に出し、開いたら確定のボタンへ焦点を移す（店-01。以前は一覧の下に1つだけ
 * 描かれ、スマホでは画面の外に出て何も起きていないように見えた）。完了済みは呼び名・人数・コードを出す（基準 20.8）。
 * 取り消しは、客に知らせが行くことと、残りの枠が戻らないことを示す（基準 21.2・18.4）。
 * ⚠️ **入れる欄は置かない**（コードを打つ欄も理由の欄も・基準 20.11・21.3）。
 */
const ConfirmPanel = ({ pending, onConfirm, onDismiss }: ConfirmProps) => {
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    confirmRef.current?.focus();
  }, []);
  const { action, row, sending } = pending;
  return (
    <div className="store-confirm store-confirm--inline" role="dialog" aria-label="確かめ" data-testid={`confirm-${action}`}>
      <p>{confirmTextOf(action, row)}</p>
      {sending ? (
        <p className="store-note" role="status">
          {ARRIVALS_TEXTS.sending}
        </p>
      ) : null}
      <div className="store-confirm__buttons">
        <button ref={confirmRef} type="button" className="store-btn store-btn--primary" data-testid="btn-confirm" disabled={sending} onClick={onConfirm}>
          {CONFIRM_LABEL_OF[action]}
        </button>
        <button type="button" className="store-btn store-btn--quiet" disabled={sending} onClick={onDismiss}>
          やめる
        </button>
      </div>
    </div>
  );
};

/** 断りの文。状態による断り（今の状態）と、それ以外の断りで出し口が分かれる（設計書「入口の一覧」の3つの形） */
const RefusalMessage = ({ refusal }: { refusal: Refusal }) =>
  refusal.failure.current ? (
    <p className="msg" role="alert" data-testid="msg-form">
      {ARRIVALS_TEXTS.refused(refusal.action, refusal.failure.current)}
    </p>
  ) : (
    <FormMessage failure={refusal.failure} />
  );

type CardProps = {
  row: ArrivalsListRow;
  /** 済んだぶん・客が取り消した行は薄く出す（操作は入口の canComplete・canCancel が決める） */
  done: boolean;
  /** 数秒だけ目立たせる（新しく来た客・今しがた取り消した客） */
  highlighted: boolean;
  partyChange: PartyChange | undefined;
  /** このカードで開いている確かめ（無ければ null） */
  pending: Pending | null;
  /** このカードで断られた操作（無ければ null） */
  refusal: Refusal | null;
  onAsk: (action: ArrivalAction, row: ArrivalsListRow) => void;
  onConfirm: () => void;
  onDismiss: () => void;
};

const cardClassName = (done: boolean, highlighted: boolean): string =>
  ["store-arrival", done ? "store-arrival--done" : "", highlighted ? "store-arrival--new" : ""].filter(Boolean).join(" ");

/** 客1組ぶんの横長のカード。左端に人数の札、右端に押せるボタン、確かめと断りの文はカードの中の下段。 */
const ArrivalCard = ({ row, done, highlighted, partyChange, pending, refusal, onAsk, onConfirm, onDismiss }: CardProps) => (
  <li className={cardClassName(done, highlighted)} data-testid={`row-${row.reservationId}`}>
    <p className="store-arrival__party" data-testid="arrival-party">
      {ARRIVALS_TEXTS.party(row.party)}
    </p>
    <div className="store-arrival__main">
      <p className="store-arrival__name">{ARRIVALS_TEXTS.who(row.nickname)}</p>
      <p className="store-arrival__meta">
        {ARRIVALS_TEXTS.kindLabel(row.kind, row.noShow === true)}・期限 {timeInJst(row.expiresAt)}
      </p>
      {isLate(row) ? <p className="store-arrival__late">{ARRIVALS_TEXTS.lateUntil(lateUntilOf(row))}</p> : null}
      {partyChange ? (
        <p className="store-arrival__changed" role="status" data-testid={`party-changed-${row.reservationId}`}>
          {ARRIVALS_TEXTS.partyChanged(partyChange.from, partyChange.to)}
        </p>
      ) : null}
      {isCustomerCancelled(row) ? (
        <p className="store-arrival__changed" role="status" data-testid={`customer-cancelled-${row.reservationId}`}>
          {ARRIVALS_TEXTS.customerCancelled}
        </p>
      ) : null}
      {/* 登録の無い客に仮の番号の発信のリンクを出さない（横断-02）。客が取り消した行には番号を出さない（横断-08） */}
      {row.kind === "customer_cancelled" ? null : (
        <p className="store-arrival__meta">{row.phone ? <a href={`tel:${row.phone}`}>{row.phone}</a> : ARRIVALS_TEXTS.noPhone}</p>
      )}
    </div>
    <div className="store-arrival__side">
      <p className="store-arrival__code">{row.code}</p>
      <div className="store-arrival__actions">
        {row.canComplete ? (
          <button type="button" className="store-btn store-btn--primary" data-testid="btn-complete" disabled={pending?.sending === true} onClick={() => onAsk("complete", row)}>
            完了
          </button>
        ) : null}
        {row.canCancel ? (
          <button type="button" className="store-btn store-btn--quiet" data-testid="btn-store-cancel" disabled={pending?.sending === true} onClick={() => onAsk("store-cancel", row)}>
            {ARRIVALS_TEXTS.cancelButton}
          </button>
        ) : null}
        {row.canCancel ? (
          <button type="button" className="store-btn store-btn--quiet" data-testid="btn-store-no-show" disabled={pending?.sending === true} onClick={() => onAsk("store-no-show", row)}>
            {ARRIVALS_TEXTS.noShowButton}
          </button>
        ) : null}
        {/* 来店なしのキャンセルだけ枠が戻ることを、ボタンの下で言う（2026-09-26 本人発案（キャンセルの語）） */}
        {row.canCancel ? (
          <p className="store-arrival__note" data-testid="no-show-note">
            {ARRIVALS_TEXTS.noShowNote}
          </p>
        ) : null}
      </div>
    </div>
    {pending ? <ConfirmPanel pending={pending} onConfirm={onConfirm} onDismiss={onDismiss} /> : null}
    {refusal ? <RefusalMessage refusal={refusal} /> : null}
  </li>
);

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
        <h2>{ARRIVALS_TEXTS.heading}</h2>
        <RefreshBar updatedAt={updatedAt} onRefresh={onRefresh} />
      </div>

      {refusal !== null && !refusalInCard ? <RefusalMessage refusal={refusal} /> : null}

      {noneComing ? <p className="store-empty store-empty--arrivals">{ARRIVALS_TEXTS.empty}</p> : null}

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
          <ul className="store-arrival-grid">{past.map((row) => renderCard(row, true))}</ul>
        </details>
      ) : null}
    </section>
  );
};

export default ArrivalsList;
