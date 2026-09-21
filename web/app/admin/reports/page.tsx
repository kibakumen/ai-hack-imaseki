// 運営の通報の一覧（設計書「運営の画面」の通報・基準 26.6）。画面の殻は静的で、中身は入口から取る。
import { ReportList } from "../../../components/admin/ReportList";

export default function AdminReportsPage() {
  return <ReportList />;
}
