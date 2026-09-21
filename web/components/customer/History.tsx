"use client";

// 過去の受け取りの見返し（要件8の基準 8.11【最終日】）。開いた時に入口を1回呼び、受け取った
// 時刻の新しい順に並べるだけ。出すのは基準 8.11 の5つ——店名・コード・確保の状態・店の住所・
// ホームページの URL。
//
// ⚠️ 「最近行った店」（`RecentStores`・基準 26.10〜26.17）とは別の一覧。あちらは通報のための
//    入口で、完了済みの行だけを出してコード・住所・URL を出さない。こちらは思い出すための一覧で、
//    取り消された確保も期限切れのままの確保も出す。
// ⚠️ ここは読むだけの画面。通報も取り消しも置かない（それぞれの持ち場の部品が持つ）。
// ⚠️ 状態の文は `domain/texts` から引くだけで、語で分岐しない（設計書「概要」の芯の1）。

import { useEffect, useState } from "react";
import { apiCall, isFailure, type ApiFailure } from "../../lib/client/api";
import { RESERVATION_STATUS_TEXTS } from "../../lib/domain/texts";
import { FormMessage } from "../ui/InputRefusal";

type HistoryItem = {
  id: string;
  code: string;
  status: string;
  storeName: string;
  storeAddress: string;
  storeUrl: string | null;
};

type HistoryResponse = { items: HistoryItem[] };

const EMPTY_MESSAGE = "まだ受け取ったお店がありません。";

export const History = () => {
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [failure, setFailure] = useState<ApiFailure | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const result = await apiCall<HistoryResponse>("GET", "/api/customer/history");
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
    <section>
      <h2>過去の受け取り</h2>

      <FormMessage failure={failure} />

      {/* 取れてから出す——取る前から「まだありません」を出すと、読めていないのか0件なのかが区別できない。 */}
      {items?.length === 0 && <p data-testid="history-empty">{EMPTY_MESSAGE}</p>}

      {items !== null && items.length > 0 && (
        <ul data-testid="history">
          {items.map((item) => (
            <li key={item.id} data-testid={`row-${item.id}`}>
              <p>{item.storeName}</p>
              <p>コード {item.code}</p>
              <p>{RESERVATION_STATUS_TEXTS.label(item.status)}</p>
              <p>{item.storeAddress}</p>
              {item.storeUrl === null ? null : (
                <a href={item.storeUrl} target="_blank" rel="noreferrer">
                  ホームページを開く
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default History;
