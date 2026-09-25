// 承認の状況の帯（要件12の基準 12.6・12.7・12.9）。店のホームの先頭にいつも1つ出る。
// 自分では判断しない——渡された状況に決まった文（domain/texts の STORE_STATUS_TEXTS）を当てるだけ（設計書「店の画面」の1）。
//
// 2026-09-25 監査の指摘 店-14: 承認済みの店にも毎回「承認済みです。オファーを公開できます。」の帯が出て、開いた直後に
// 見たい「向かっている客」と公開中のカードを下へ押し出していた。帯のクラスには見た目も無く、3つの状態を色で
// 見分けられなかった。今は——承認済みは**小さな札**、未承認と止められているときは**色つきの帯**（状態は
// `data-status` で渡し、色は store.css が持つ）。
//
// 2026-09-25 監査の指摘 店-12: 未承認と止められているときは、次に何が起きるか（許可書を確かめてから承認する／
// 向かっていた客は取り消されて通知済み・期限切れも完了にできない）と、運営の連絡先を帯に足した。

import { STORE_STATUS_TEXTS } from "../../lib/domain/texts";
import { ContactEmail } from "../ui/ContactEmail";

export type StoreStatusValue = "pending" | "approved" | "banned";

const BANNER_TEXTS: Record<Exclude<StoreStatusValue, "approved">, { lead: string; detail: string }> = {
  pending: { lead: STORE_STATUS_TEXTS.pending, detail: STORE_STATUS_TEXTS.pendingDetail },
  banned: { lead: STORE_STATUS_TEXTS.banned, detail: STORE_STATUS_TEXTS.bannedDetail },
};

export const StatusBanner = ({ status }: { status: StoreStatusValue }) =>
  status === "approved" ? (
    <p className="status-banner status-banner--approved" role="status" data-testid="status-banner" data-status="approved">
      <span aria-hidden="true">✓</span> 承認済み
    </p>
  ) : (
    <div className="status-banner" role="status" data-testid="status-banner" data-status={status}>
      <p className="status-banner__lead">{BANNER_TEXTS[status].lead}</p>
      <p className="status-banner__detail">
        {BANNER_TEXTS[status].detail} <ContactEmail />
      </p>
    </div>
  );

export default StatusBanner;
