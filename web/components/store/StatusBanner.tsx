// 承認の状況の帯（要件12の基準 12.6・12.7・12.9）。店のホームの先頭にいつも1つ出る。
// 自分では判断しない——渡された状況に決まった文を当てるだけ（設計書「店の画面」の1）。

export type StoreStatusValue = "pending" | "approved" | "banned";

const BANNER_TEXTS: Record<StoreStatusValue, string> = {
  pending: "未承認です。運営の承認を待っています。承認されるまでオファーは公開できません。",
  approved: "承認済みです。オファーを公開できます。",
  banned: "運営に止められているため、オファーは公開できません。",
};

export const StatusBanner = ({ status }: { status: StoreStatusValue }) => (
  <p className="status-banner" role="status" data-testid="status-banner">
    {BANNER_TEXTS[status]}
  </p>
);

export default StatusBanner;
