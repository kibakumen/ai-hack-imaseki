// 運営の店の詳細（設計書「運営の画面」の店の詳細）。動的な区間は Next.js が約束で渡す。
// 一覧から来たときは、一覧の絞り込み・検索・並び順を問い合わせ文字列で受け取り、戻るリンクへ渡す（運営-06）。
import type { Metadata } from "next";
import { StoreDetail } from "../../../../components/admin/StoreDetail";
import { pickListQuery, toListQueryString } from "../../../../components/admin/listQuery";

export const metadata: Metadata = { title: "店の詳細（運営）" };

type PageProps = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminStoreDetailPage({ params, searchParams }: PageProps) {
  const [{ id }, search] = await Promise.all([params, searchParams]);
  return <StoreDetail storeId={id} listQuery={toListQueryString(pickListQuery(search))} />;
}
