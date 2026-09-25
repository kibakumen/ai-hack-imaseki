// 承認の状況の帯（要件12の基準 12.6・12.7・12.9）。店のホームの先頭にいつも1つ出る。
// 自分では判断しない——渡された状況に決まった文を当てるだけ（設計書「店の画面」の1）。
//
// 2026-09-25 監査の指摘 店-14: 承認済みの店にも毎回「承認済みです。オファーを公開できます。」の帯が出て、開いた直後に
// 見たい「向かっている客」と公開中のカードを下へ押し出していた。帯のクラスには見た目も無く、3つの状態を色で
// 見分けられなかった。今は——承認済みは**小さな札**、未承認と止められているときは**色つきの帯**（状態は
// `data-status` で渡し、色は store.css が持つ）。

export type StoreStatusValue = "pending" | "approved" | "banned";

const BANNER_TEXTS: Record<Exclude<StoreStatusValue, "approved">, string> = {
  pending: "未承認です。運営の承認を待っています。承認されるまでオファーは公開できません。",
  banned: "運営に止められているため、オファーは公開できません。",
};

export const StatusBanner = ({ status }: { status: StoreStatusValue }) =>
  status === "approved" ? (
    <p className="status-banner status-banner--approved" role="status" data-testid="status-banner" data-status="approved">
      <span aria-hidden="true">✓</span> 承認済み
    </p>
  ) : (
    <p className="status-banner" role="status" data-testid="status-banner" data-status={status}>
      {BANNER_TEXTS[status]}
    </p>
  );

export default StatusBanner;
