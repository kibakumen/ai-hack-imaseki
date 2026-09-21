// 店の画面だけに効く見た目を読み込む殻（2026-09-22）。
// 中身は何も足さない——`store.css` を店の枝の下に閉じ込めるためだけに在る。
// 置き場所の理由: `app/globals.css` は客・運営の画面とも共有する面なので、店の都合で太らせない。
import "./store.css";

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return children;
}
