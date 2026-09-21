// 運営の店の詳細（設計書「運営の画面」の店の詳細）。動的な区間は Next.js が約束で渡す。
import { StoreDetail } from "../../../../components/admin/StoreDetail";

export default async function AdminStoreDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StoreDetail storeId={id} />;
}
