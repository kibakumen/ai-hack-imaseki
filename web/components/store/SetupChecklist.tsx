"use client";

// 承認までに足りないもののチェックリスト（要件12の基準 12.7・12.8）。クーポンは任意なので載せない。
// ⚠️ この部品はタスク7（営業許可書とカード・店のホームの帯）の持ち場。タスク9 は、店のホームを
// 組み立てるのに要るので最小の形で置いた（重なったら7の版へ寄せる）。

type Props = {
  checklist: { license: boolean; card: boolean };
  /** 店名・住所・ジャンル・予算の幅のうち埋まっていないもの（domain/storeHome の missingStoreProfile） */
  missingProfile: string[];
};

const missingMark = (missing: boolean) => (missing ? "true" : undefined);

export const SetupChecklist = ({ checklist, missingProfile }: Props) => (
  <ul data-testid="setup-checklist">
    <li data-missing={missingMark(!checklist.license)}>
      営業許可書 <a href="/store/documents">登録する</a>
    </li>
    <li data-missing={missingMark(!checklist.card)}>
      カード <a href="/store/documents">登録する</a>
    </li>
    <li data-missing={missingMark(missingProfile.length > 0)}>
      店の情報（店名・住所・ジャンル・予算の幅） <a href="/store/profile">入れる</a>
    </li>
  </ul>
);

export default SetupChecklist;
