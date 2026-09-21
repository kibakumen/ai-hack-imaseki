"use client";

// 「向かっている客」の一覧（要件20）。行の中身・出す／出さない・できる操作はすべて入口が決めた値で、
// **この部品は描くだけ**（判断は `domain/storeHome` の `arrivalRows` と `domain/reservation` の
// `canComplete`）。押したときの1手だけをここが持つ:
//
//   - 完了済み（基準 20.8）… 呼び名・人数・コードを出して確かめを求め、確かめてから要求を出す
//   - 取り消し（要件21の基準 21.2・21.3）… 客に知らせが送られることを示して確かめを求める。理由は聞かない
//   - 断られたとき（基準 20.20・20.21）… その確保の今の状態を文にして出し、一覧を取り直す
//
// 置かない操作（基準 20.10・20.11・20.17）: 完了済みを元の状態にする操作・完了済みを取り消す操作・
// コードを打ち込む欄・使われたクーポンを記録する欄。この部品に入力欄は1つも無い。

import { useState } from "react";
import { apiCall, isFailure, type ApiFailure } from "../../lib/client/api";
import { ARRIVALS_TEXTS } from "../../lib/domain/texts";
import { FormMessage } from "../ui/InputRefusal";
import { timeInJst } from "./jstTime";

/** 入口 `GET /api/store/home` の `arrivals` の1行（受け入れ検査の契約 `ArrivalRow`）。 */
export type ArrivalsListRow = {
  reservationId: string;
  kind: "active" | "expired" | "completed" | "store_cancelled";
  nickname: string;
  phone: string;
  party: number;
  code: string;
  expiresAt: string;
  canComplete: boolean;
  canCancel: boolean;
};

type ArrivalAction = "complete" | "store-cancel";

type Props = {
  rows: ArrivalsListRow[];
  /** 要求のあと（通っても断られても）一覧を取り直す（基準 20.21） */
  onChanged: () => void;
};

const pathOf = (action: ArrivalAction, reservationId: string): string =>
  `/api/store/reservations/${encodeURIComponent(reservationId)}/${action === "complete" ? "complete" : "cancel"}`;

export const ArrivalsList = ({ rows, onChanged }: Props) => {
  const [pending, setPending] = useState<{ action: ArrivalAction; row: ArrivalsListRow } | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  const ask = (action: ArrivalAction, row: ArrivalsListRow) => {
    setFailure(null);
    setPending({ action, row });
  };

  const send = async (action: ArrivalAction, row: ArrivalsListRow) => {
    setPending(null);
    // コードも理由も送らない（基準 20.11・要件21の基準 21.3）
    const result = await apiCall("POST", pathOf(action, row.reservationId), {});
    setFailure(isFailure(result) ? result : null);
    // 断られたときも取り直す——古い行が残っているのが断りの原因なので（基準 20.21）
    onChanged();
  };

  return (
    <section data-testid="arrivals">
      <h2>向かっている客</h2>

      {rows.length === 0 ? (
        <p>{ARRIVALS_TEXTS.empty}</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.reservationId} data-testid={`row-${row.reservationId}`}>
              <p>{ARRIVALS_TEXTS.kindLabel(row.kind)}</p>
              <p>
                {row.nickname} さん／{row.party} 名
              </p>
              <p>コード {row.code}</p>
              <p>
                <a href={`tel:${row.phone}`}>{row.phone}</a>
              </p>
              <p>期限 {timeInJst(row.expiresAt)}</p>
              {row.canComplete ? (
                <button type="button" data-testid="btn-complete" onClick={() => ask("complete", row)}>
                  完了済みにする
                </button>
              ) : null}
              {row.canCancel ? (
                <button type="button" data-testid="btn-store-cancel" onClick={() => ask("store-cancel", row)}>
                  この確保を取り消す
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {pending === null ? null : (
        <div role="dialog" aria-label="確かめ" data-testid={`confirm-${pending.action}`}>
          {pending.action === "complete" ? (
            <p>
              {pending.row.nickname} さん・{pending.row.party} 名・コード {pending.row.code} の来店を確かめましたか。
            </p>
          ) : (
            <p>取り消すと、客に知らせが送られます。この確保を取り消しますか。</p>
          )}
          <button
            type="button"
            data-testid="btn-confirm"
            onClick={() => {
              void send(pending.action, pending.row);
            }}
          >
            {pending.action === "complete" ? "完了済みにする" : "取り消す"}
          </button>
          <button type="button" onClick={() => setPending(null)}>
            やめる
          </button>
        </div>
      )}

      {/* 断った理由は、状態による断り（今の状態）と、それ以外の断りで出し口が分かれる（設計書「入口の一覧」の3つの形） */}
      {failure?.current ? (
        <p className="msg" role="alert" data-testid="msg-form">
          {ARRIVALS_TEXTS.refused(failure.current.state)}
        </p>
      ) : (
        <FormMessage failure={failure} />
      )}
    </section>
  );
};

export default ArrivalsList;
