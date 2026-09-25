"use client";

// 過去の受け取りの見返し（要件8の基準 8.11【最終日】）。開いた時に入口を1回呼び、受け取った
// 時刻の新しい順に並べるだけ。出すのは基準 8.11 の5つ——店名・コード・確保の状態・店の住所・
// ホームページの URL——と、受け取った日時。
//
// **「最近行った店」の脇の画面の中に出す**（2026-09-25 監査の指摘 客-13 の案A・AI判断）。以前はどこからも
// 読み込まれておらず、一度も画面に載ったことが無かった（入口と受け入れ検査だけが在った）。客は前に行った店の
// 住所をもう一度たどれなかった。下に「もう一度探す」を置く（取得の画面へ）。
//
// ⚠️ 「最近行った店」（`RecentStores`・基準 26.10〜26.17）の行とは別の一覧。あちらは通報のための
//    入口で、完了済みの行だけを出してコード・住所・URL を出さない（基準 26.17）。こちらは思い出すための一覧で、
//    取り消された確保も期限切れのままの確保も出す。行の data-testid も分けてある（`history-row-…`）。
// ⚠️ ここは読むだけの画面。通報も取り消しも置かない（それぞれの持ち場の部品が持つ）。
// ⚠️ 状態の文は `domain/texts` から引くだけで、語で分岐しない（設計書「概要」の芯の1）。

import { useEffect, useState } from "react";
import { callApi, isFailure, type ApiFailure, type ResponseOf } from "../../lib/client/api";
import { RESERVATION_STATUS_TEXTS } from "../../lib/domain/texts";
import { FormMessage } from "../ui/InputRefusal";
import { dateTimeInJst } from "../ui/jstTime";

// 応答の型は、サーバーと同じ定義（schemas/responses の表）から作る——手で写さない（2026-09-25 監査の指摘 設計-07）。
type HistoryItem = ResponseOf<"GET /api/customer/history">["items"][number];

const EMPTY_MESSAGE = "まだ受け取ったお店がありません。";

type HistoryProps = {
  /** 「もう一度探す」（取得の画面へ。確保を持っていれば、持ったまま探す） */
  onSearchAgain: () => void;
};

export const History = ({ onSearchAgain }: HistoryProps) => {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const result = await callApi("GET /api/customer/history");
      if (!alive) return;
      if (isFailure(result)) {
        setFailure(result);
        setItems(null);
        return;
      }
      setItems(result.items);
      setFailure(null);
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="history" aria-label="過去の受け取り">
      <h2>過去の受け取り</h2>

      <FormMessage failure={failure} />

      {/* 取れてから出す——取る前から「まだありません」を出すと、読めていないのか0件なのかが区別できない。 */}
      {items?.length === 0 && <p data-testid="history-empty">{EMPTY_MESSAGE}</p>}

      {items !== null && items.length > 0 && (
        <ul className="history__list" data-testid="history">
          {items.map((item) => (
            <li key={item.id} className="history__row" data-testid={`history-row-${item.id}`}>
              <p className="history__store">{item.storeName}</p>
              <p className="history__meta">
                {dateTimeInJst(item.receivedAt)}・{RESERVATION_STATUS_TEXTS.label(item.status)}・コード {item.code}
              </p>
              <p className="history__address">{item.storeAddress}</p>
              {item.storeUrl === null ? null : (
                <a href={item.storeUrl} target="_blank" rel="noreferrer">
                  ホームページを開く
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      <button type="button" data-testid="btn-history-search" onClick={onSearchAgain}>
        もう一度探す
      </button>
    </section>
  );
};

export default History;
