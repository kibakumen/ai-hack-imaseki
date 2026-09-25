// 店のホーム（設計書「店の画面」: 承認の状況の帯・準備のチェックリスト・公開のフォーム／公開中のカード）。
import type { Metadata } from "next";
import { StoreHome } from "../../components/store/StoreHome";

export const metadata: Metadata = { title: "オファー" };

export default function StoreHomePage() {
  return <StoreHome />;
}
