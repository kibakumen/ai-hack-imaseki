// 書類の画面（設計書「店の画面」の下のナビの「書類（営業許可書とカード）」）。
import type { Metadata } from "next";
import { StoreNav } from "../../../components/store/StoreNav";
import { DocumentsPanel } from "../../../components/store/DocumentsPanel";

export const metadata: Metadata = { title: "書類" };

export default function StoreDocumentsPage() {
  return (
    <main className="store-main">
      <StoreNav active="documents" />
      <DocumentsPanel />
    </main>
  );
}
