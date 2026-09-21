import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <h1>AI セキトリ</h1>
      <p>近くのお店の空席を、今の条件から探します。</p>
      <nav aria-label="はじめる">
        <Link href="/me">お店を探す</Link>
        <Link href="/login">お店の方はこちら</Link>
      </nav>
    </main>
  );
}
