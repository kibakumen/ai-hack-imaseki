// 客の画面だけに効く見た目を読み込む殻（2026-09-22）。
// 中身は何も足さない——`me.css` を客の枝の下に閉じ込めるためだけに在る（店の `app/store/layout.tsx` と同じ形）。
//
// ⚠️ この殻が無いあいだ、`me.css`（756行）は**誰からも import されておらず本番に1バイトも載っていなかった**。
// 本番の CSS チャンクを実測して判った（`.claimed-celebration` も `.offer-card` も 0 件）。
// Next.js は import された CSS だけを束ねるので、ファイルが在るだけでは配信されない。
import "./me.css";

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
