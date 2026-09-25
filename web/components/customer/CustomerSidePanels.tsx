"use client";

// 客の画面の下の方の脇の画面——「最近行った店」とその中の過去の受け取りの見返し（2026-09-25 監査の指摘 設計-16 で
// CustomerApp から分けた。振る舞いは分ける前と同じ）。通報の欄と「この端末の登録を消す」は入れ物が持つ
// （通報は確保中・完了済みの表示からも開くため）。

import { useState } from "react";
import { useBackLayer } from "../../lib/client/useBackLayer";
import { History } from "./History";
import { RecentStores } from "./RecentStores";
import type { ReportTarget } from "./ReportForm";

type CustomerSidePanelsProps = {
  /** 「最近行った店」の入口を置くか（基準 26.14。取得の画面・確保中・完了済みの3つだけ） */
  showEntry: boolean;
  onReport: (target: ReportTarget) => void;
  /** 見返しの「もう一度探す」 */
  onSearchAgain: () => void;
};

export const CustomerSidePanels = ({ showEntry, onReport, onSearchAgain }: CustomerSidePanelsProps) => {
  const [open, setOpen] = useState(false);
  // 端末の「戻る」で閉じる（客-03）
  useBackLayer(open, () => setOpen(false));
  return (
    <>
      {showEntry ? (
        <nav aria-label="そのほか">
          <button type="button" data-testid="btn-recent" onClick={() => setOpen((current) => !current)}>
            最近行った店
          </button>
        </nav>
      ) : null}

      {/* 最近行った店（通報の入口）の下に、過去の受け取りの見返し（住所・ホームページ・もう一度探す・客-13 の案A） */}
      {open ? (
        <>
          <RecentStores onReport={onReport} />
          <History
            onSearchAgain={() => {
              setOpen(false);
              onSearchAgain();
            }}
          />
        </>
      ) : null}
    </>
  );
};
