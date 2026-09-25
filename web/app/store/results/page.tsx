// 実績の画面（設計書「店の画面」の下のナビの「実績」）。殻は静的で、中身は入口から取る。
import type { Metadata } from "next";
import { ResultsTable } from "../../../components/store/ResultsTable";

export const metadata: Metadata = { title: "実績" };

export default function StoreResultsPage() {
  return <ResultsTable />;
}
