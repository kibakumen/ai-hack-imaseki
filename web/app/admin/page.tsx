// 運営のホーム＝店の一覧（設計書「運営の画面」）。画面の殻は静的で、中身は入口から取る。
// 絞り込み・ジャンル・検索・並び順は URL の問い合わせ文字列から受け取る（詳細から戻っても条件が残る・運営-06）。
import type { Metadata } from "next";
import { StoreList } from "../../components/admin/StoreList";
import { pickListQuery } from "../../components/admin/listQuery";

export const metadata: Metadata = { title: "店の一覧（運営）" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminHomePage({ searchParams }: PageProps) {
  return <StoreList initialQuery={pickListQuery(await searchParams)} />;
}
