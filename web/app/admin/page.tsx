// 運営のホーム＝店の一覧（設計書「運営の画面」）。画面の殻は静的で、中身は入口から取る。
import { StoreList } from "../../components/admin/StoreList";

export default function AdminHomePage() {
  return <StoreList />;
}
