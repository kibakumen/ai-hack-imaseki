// 店の画面だけに効く見た目を読み込む殻（2026-09-22）。
// 中身は何も足さない——`store.css` を店の枝の下に閉じ込めるためだけに在る。
// 置き場所の理由: `app/globals.css` は客・運営の画面とも共有する面なので、店の都合で太らせない。
// 店の画面の CSS は続きの順のまま6つに分けた（2026-09-25 監査の指摘 設計-16）——読み込む順を変えない
import "./store.css";
import "./store-arrivals.css";
import "./store-dial.css";
import "./store-forms.css";
import "./store-offer.css";
import "./store-results.css";
import "./store-thumb.css";
import { SessionExpiredNotice } from "../../components/ui/SessionExpired";
import { ThemeToggle } from "../../components/ui/ThemeToggle";

// 明暗の切り替えボタンをここで1つだけ足す（/store 以下の全ページがこの殻を通る）。
// `position: fixed` で描くので children（各ページの StoreNav・main）の DOM 構造は変えない。
// ログインが切れたときの知らせ（「ログインが切れました」と /login への道）もここに1つだけ置く
// ——どの画面のどの読み込み・操作で 401 を受けても同じ所に出る（2026-09-25 監査の指摘 横断-01）。
//
// 2026-10-08 本人選択「案C 片手の親指」: children を `.store-app` で包む——案C の配色（store.css の --st-* と、--color-* の
// 置き換え）を店の画面の中だけに効かせるため。明暗の切り替えは body の直下のまま（globals.css が `body:has(> .theme-toggle)` で見る）。
export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SessionExpiredNotice />
      <div className="store-app">{children}</div>
      <ThemeToggle />
    </>
  );
}
