"use client";

// 承認の状況の帯（要件12の基準 12.6・12.9）。
// ⚠️ この部品はタスク7（営業許可書とカード・店のホームの帯）の持ち場。タスク9 は、公開のフォームと
// 公開中のカードを載せる StoreHome が帯を要るので最小の形で置いた（重なったら7の版へ寄せる）。

export type StoreStatusValue = "pending" | "approved" | "banned";

const BANNER_TEXTS: Record<StoreStatusValue, string> = {
  pending: "未承認です。運営の承認を待っています。承認されるまでオファーは公開できません。",
  approved: "承認済みです。オファーを公開できます。",
  banned: "運営に止められているため、オファーは公開できません。",
};

export const StatusBanner = ({ status }: { status: StoreStatusValue }) => (
  <p data-testid="status-banner" role="status">
    {BANNER_TEXTS[status] ?? BANNER_TEXTS.pending}
  </p>
);

export default StatusBanner;
