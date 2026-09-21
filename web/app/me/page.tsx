// 客の画面（1つの URL。表示の切り替えは components/customer が持つ・設計書「客の画面」）。
//
// 入口は `GuestEntry`——開いた瞬間に識別子が無ければ裏で登録を済ませ、客に登録の画面を見せない
// （2026-09-22 の本人の指摘「画面を開いた瞬間に今すぐ探すボタンを押せること」）。
// 登録が通らなかったときは `GuestEntry` がそのまま `CustomerApp` を描き、手で入れる登録の入力が出る。
import { GuestEntry } from "../../components/customer/GuestEntry";

export default function CustomerPage() {
  return <GuestEntry />;
}
