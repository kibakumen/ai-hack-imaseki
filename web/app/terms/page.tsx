// 客向けの利用規約（2026-09-26 本人選択）。
//
// それまで客向けの利用規約のページは無く、Google Maps Platform の利用規約 3.2.2(a)(i) が求める「アプリの利用規約で
// Google マップの機能を含むと知らせ、追加利用規約と Google プライバシーポリシーに従うと書く」を置く場所が無かった。
// 知らせの中身は components/ui/GoogleMapsTerms（店向けの利用規約と共用）。
//
// ⚠️ 文面は AI判断の下書き（2026-09-26）。客との約束の全体（禁止事項・免責・準拠法など）は、事業として営む前に
//    運営者が法的な確認を済ませて書き足す。送信先と個人情報の扱いは /privacy が正本（ここに写さない）。
//    同意の操作は置いていない（客の登録は自動で作る呼び名だけで、同意の記録の仕組みも無い・AI判断）。

import type { Metadata } from "next";
import Link from "next/link";
import { ContactEmail } from "../../components/ui/ContactEmail";
import { GoogleMapsTerms } from "../../components/ui/GoogleMapsTerms";
import "./terms.css";

export const metadata: Metadata = { title: "利用規約" };

export default function TermsPage() {
  return (
    <main className="customer-terms">
      <h1>利用規約</h1>
      <p className="customer-terms__lead">
        イマセキは、近くのお店の空いている席を見つけて、その場で確保できるサービスです。大会の審査期間中のデモとして動かしています。
      </p>

      <GoogleMapsTerms />

      <section data-testid="terms-privacy">
        <h2>送る情報と個人情報</h2>
        <p>
          何をどこへ何のために送っているかと、保存しているものの消し方は、<Link href="/privacy">送信先と個人情報の扱い</Link>
          にまとめています。
        </p>
      </section>

      <section data-testid="terms-contact">
        <h2>問い合わせ先</h2>
        <p>
          連絡先: <ContactEmail />
        </p>
      </section>
    </main>
  );
}
