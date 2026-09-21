// 客の画面（1つの URL。表示の切り替えは components/customer が持つ・設計書「客の画面」）。
import { CustomerApp } from "../../components/customer/CustomerApp";
import "./me.css";

export default function CustomerPage() {
  return <CustomerApp />;
}
