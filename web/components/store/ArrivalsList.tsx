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
// コードを打ち込む欄・使われたクーポンを記録する欄。**この部品に入力欄は1つも無い。**
//
// 見た目は 2026-09-21 の本人の指摘を入れた（速成版 sprint/app/store が基準）:
//   - 店が見るのはまずここなので、**画面のいちばん上**に置く（置き場所は StoreHome が決める）
//   - 1人1枚の**横長のカード**で、呼び名と人数の右に**完了のボタンをそのまま**置く（探さずに押せる）
//   - 済んだぶん（完了済み・期限切れ・取り消し）は畳んで下へ——**消さない**（見返せる）
//   - 完了にできた時は音を鳴らす。新しく来た客のカードは出るときに少し跳ねる（CSS の動き）

import { useState } from "react";
import { apiCall, isFailure, type ApiFailure } from "../../lib/client/api";
import { ARRIVALS_TEXTS } from "../../lib/domain/texts";
import { FormMessage } from "../ui/InputRefusal";
import { playNotifyBeep } from "./beep";
import { timeInJst } from "../ui/jstTime";

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

type CardProps = {
  row: ArrivalsListRow;
  /** 済んだぶんは薄く出す（操作は入口の canComplete・canCancel が決める） */
  done: boolean;
  onAsk: (action: ArrivalAction, row: ArrivalsListRow) => void;
};

/** 客1組ぶんの横長のカード。右端に押せるボタンを置く。 */
const ArrivalCard = ({ row, done, onAsk }: CardProps) => (
  <li className={done ? "store-arrival store-arrival--done" : "store-arrival"} data-testid={`row-${row.reservationId}`}>
    <div className="store-arrival__main">
      <p className="store-arrival__name">
        {row.nickname} さん（{row.party} 名）
      </p>
      <p className="store-arrival__meta">
        {ARRIVALS_TEXTS.kindLabel(row.kind)}・期限 {timeInJst(row.expiresAt)}
      </p>
      <p className="store-arrival__meta">
        <a href={`tel:${row.phone}`}>{row.phone}</a>
      </p>
    </div>
    <div className="store-arrival__side">
      <p className="store-arrival__code">{row.code}</p>
      <div className="store-arrival__actions">
        {row.canComplete ? (
          <button type="button" className="store-btn store-btn--primary" data-testid="btn-complete" onClick={() => onAsk("complete", row)}>
            完了
          </button>
        ) : null}
        {row.canCancel ? (
          <button type="button" className="store-btn store-btn--quiet" data-testid="btn-store-cancel" onClick={() => onAsk("store-cancel", row)}>
            取り消す
          </button>
        ) : null}
      </div>
    </div>
  </li>
);

/**
 * 押す前の確かめ。**完了済みは呼び名・人数・コードを出す**（基準 20.8）——店が手元の画面と
 * 見比べて、別の組を完了にしないため。取り消しは、客に知らせが行くことを示す（基準 21.2）。
 * ⚠️ **入れる欄は置かない**（コードを打つ欄も理由の欄も・基準 20.11・21.3）。
 */
const ConfirmDialog = ({
  action,
  row,
  onConfirm,
  onDismiss,
}: {
  action: ArrivalAction;
  row: ArrivalsListRow;
  onConfirm: () => void;
  onDismiss: () => void;
}) => (
  <div className="store-confirm" role="dialog" aria-label="確かめ" data-testid={`confirm-${action}`}>
    {action === "complete" ? (
      <p>
        {row.nickname} さん・{row.party} 名・コード {row.code} の来店を確かめましたか。
      </p>
    ) : (
      <p>取り消すと、客に知らせが送られます。この確保を取り消しますか。</p>
    )}
    <div className="store-confirm__buttons">
      <button type="button" className="store-btn store-btn--primary" data-testid="btn-confirm" onClick={onConfirm}>
        {action === "complete" ? "完了済みにする" : "取り消す"}
      </button>
      <button type="button" className="store-btn store-btn--quiet" onClick={onDismiss}>
        やめる
      </button>
    </div>
  </div>
);

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
    const refused = isFailure(result);
    setFailure(refused ? result : null);
    // 手が離せない店でも気づけるように、通った時だけ音を鳴らす（鳴らせない環境では何も起きない）
    if (!refused) playNotifyBeep();
    // 断られたときも取り直す——古い行が残っているのが断りの原因なので（基準 20.21）
    onChanged();
  };

  // 今まさに向かっている組を上に、済んだ組を下に畳む。**どちらにも同じ行を二重に出さない。**
  const waiting = rows.filter((row) => row.kind === "active");
  const past = rows.filter((row) => row.kind !== "active");

  return (
    <section className="store-arrivals" data-testid="arrivals">
      <h2>向かっている客</h2>

      {rows.length === 0 ? <p className="store-empty store-empty--arrivals">{ARRIVALS_TEXTS.empty}</p> : null}

      {waiting.length > 0 ? (
        <ul className="store-arrival-grid">
          {waiting.map((row) => (
            <ArrivalCard key={`${row.reservationId}:${row.kind}`} row={row} done={false} onAsk={ask} />
          ))}
        </ul>
      ) : null}

      {past.length > 0 ? (
        <details className="store-past">
          <summary>済んだぶん（{past.length}件）</summary>
          <ul className="store-arrival-grid">
            {past.map((row) => (
              <ArrivalCard key={`${row.reservationId}:${row.kind}`} row={row} done onAsk={ask} />
            ))}
          </ul>
        </details>
      ) : null}

      {pending === null ? null : (
        <ConfirmDialog
          action={pending.action}
          row={pending.row}
          onConfirm={() => {
            void send(pending.action, pending.row);
          }}
          onDismiss={() => setPending(null)}
        />
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
