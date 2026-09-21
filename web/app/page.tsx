import Link from "next/link";

// 入口（2026-09-22 に見た目を直した。素のリンクが2本並ぶだけの面だったので、
// 「客として探す」と「店として入る」のどちらを押すのかが一目で分かる段を付けた。
// 色は持たない——形と役割だけを class 名で指し、色は `app/globals.css` の変数）。
export default function HomePage() {
  return (
    <main>
      <section className="entry">
        <p className="entry__eyebrow">今から入れるお店だけ</p>
        <h1 className="entry__title">AkI席</h1>
        <p className="entry__lead">近くのお店の空席を、今の条件から探します。登録はいりません——場所と人数だけで探せます。</p>
        <nav aria-label="はじめる" className="entry__actions">
          <Link className="entry__primary" href="/me">
            🔍 お店を探す
          </Link>
          <Link className="entry__secondary" href="/login">
            お店の方はこちら
          </Link>
        </nav>
      </section>
    </main>
  );
}
