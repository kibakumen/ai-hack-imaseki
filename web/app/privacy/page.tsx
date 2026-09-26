// 送信先と個人情報の扱い（2026-09-25 監査の指摘 安全-18 の案1）。
//
// 何を・どこへ・何のために送っているかを1枚にまとめる（電気通信事業法の外部送信規律・個人情報保護法の
// 公表事項に当たるかは事業として営むかどうかに依り、断定できない——当たる前提で置いておく）。
// 表の中身は実装から数えた送信先（lib/adapters の呼び出し先・画面が読み込む札・画面から開く外の URL）。
// **送信先を足したら、この表も直す**（表に無い送信は、客には無いのと同じに見える）。
//
// ⚠️ 事業者の名称・住所・代表者は、運営者が決めて書き足す（コードからは分からない・準備中と明記する）。

import type { Metadata } from "next";
import { ContactEmail } from "../../components/ui/ContactEmail";
import "./privacy.css";

export const metadata: Metadata = { title: "送信先と個人情報の扱い" };

type Destination = { key: string; to: string; what: string; when: string; why: string };

/** 外へ送っている先。並びは、客が画面を開いてから出会う順。 */
const DESTINATIONS: readonly Destination[] = [
  {
    key: "turnstile",
    to: "Cloudflare, Inc.（米国）— Turnstile",
    what: "ブラウザと端末の情報（Cloudflare が集めます）",
    when: "初めて客の画面を開いたとき・登録するとき・ログインするとき",
    why: "人かどうかを確かめ、機械による大量の登録を防ぐため",
  },
  {
    key: "cloudflare",
    to: "Cloudflare, Inc.（米国）— Workers・D1・R2",
    what: "画面からの要求のすべて。保存するもの: 客の識別子（端末の Cookie。サーバーには変換した値だけ）・呼び名（自動で作ります）・電話番号（任意）・好みのジャンル・予算の上限、探したときの起点の緯度経度と条件、席の確保、通知の宛先。店舗情報・営業許可書・店の画像",
    when: "使うたび",
    why: "サービスを動かし、席の確保を店とつなぐため",
  },
  {
    key: "google-maps-api",
    to: "Google LLC（米国）— Geocoding API・Places API",
    what: "現在地の座標、場所の欄に打った文字、店の住所",
    when: "「現在地を使う」を押したとき（押したことのある端末では画面を開いたとき）・場所の文字で探すとき・打っている間の候補・店が住所を保存したとき",
    why: "地名と位置を相互に直し、歩いて行ける店を探すため",
  },
  {
    key: "ai",
    to: "OrcaRouter（所在は運営者が確認中）と、その先の AI の事業者（Google・OpenAI・Anthropic。いずれも米国）",
    what: "その回の人数・ジャンル・予算の上限と、候補の店舗情報（店名・ジャンル・メニュー・距離・クーポン）。呼び名と電話番号は渡しません",
    when: "「今すぐ探す」を押したとき",
    why: "条件に合う店を選び、紹介文を書くため",
  },
  {
    key: "voice",
    to: "ブラウザの音声認識の提供元（Chrome なら Google LLC・米国）",
    what: "話した声",
    when: "「声で入れる」を押して話している間だけ",
    why: "条件を声で入れるため（文字にしたあとの読み取りは端末の中で行います）",
  },
  {
    key: "push",
    to: "端末の通知の配信元（ブラウザの提供元: Google・Apple・Mozilla など）",
    what: "席の確保の状態の知らせ（呼び名と電話番号は含めません）",
    when: "通知を許可した客の確保が変わったとき",
    why: "確保の期限や取り消しを知らせるため",
  },
  {
    key: "google-maps-link",
    to: "Google LLC（米国）— Google マップ",
    what: "経路の出発地（探した起点）と店の住所",
    when: "客が経路の案内を開いたとき",
    why: "店までの道を案内するため",
  },
  {
    key: "stripe",
    to: "Stripe, Inc.（米国）",
    what: "店のカードの情報（Stripe の画面で入力します。このサービスはカードの番号を持ちません）",
    when: "店がカードを登録するとき",
    why: "店の利用料の支払いの準備のため",
  },
  {
    // メールアドレスの確認（2026-09-26 に枝 feat/email-verify から取り込んだ）。秘密 RESEND_API_KEY と MAIL_FROM を
    // 入れたときだけ送る（入れていない公開先では送らない）。実物は lib/adapters/resend.ts（api.resend.com へ POST）。
    key: "resend",
    to: "Resend（米国。運営会社の名称は運営者が確認中）",
    what: "店と運営のログインのメールアドレスと、確認のリンクを載せたメールの本文（客の情報は含めません）",
    when: "店か運営が「確認メールを送る」を押したとき（メールの送信を有効にしている間だけ）",
    why: "登録したメールアドレスに届くことを確かめるため",
  },
  {
    key: "store-site",
    to: "店が登録したホームページ",
    what: "そのページの読み取りの要求（客の情報は含めません）",
    when: "店が情報を保存したとき",
    why: "店の雰囲気の画像を1回だけ取り込むため",
  },
];

export default function PrivacyPage() {
  return (
    <main className="privacy">
      <h1>送信先と個人情報の扱い</h1>
      <p className="privacy__lead">
        イマセキは、大会の審査期間中のデモとして動かしています。電話番号は任意で、入れなくても使えます。
      </p>

      <section aria-labelledby="privacy-destinations-head">
        <h2 id="privacy-destinations-head">外へ送っている情報（何を・どこへ・何のため）</h2>
        <div className="privacy__scroll">
          <table className="privacy__table" data-testid="privacy-destinations">
            <thead>
              <tr>
                <th scope="col">送信先（事業者・国）</th>
                <th scope="col">送る情報</th>
                <th scope="col">いつ</th>
                <th scope="col">何のため</th>
              </tr>
            </thead>
            <tbody>
              {DESTINATIONS.map((row) => (
                <tr key={row.key} data-testid={row.key === "ai" ? "privacy-ai-row" : undefined}>
                  <td>{row.to}</td>
                  <td>{row.what}</td>
                  <td>{row.when}</td>
                  <td>{row.why}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="privacy-erase-head">
        <h2 id="privacy-erase-head">保存しているものと、消し方</h2>
        <ul>
          <li>客の呼び名（自動で作ったもの）・電話番号・好みのジャンル・予算の上限は、客の画面のいちばん下の「この端末の登録を消す」で消せます（席を確保している間は、先に取り消してください）。通知の宛先も一緒に消えます。</li>
          <li>消したあとも、探したときの記録（客の識別子・起点の緯度経度・条件）は集計のために残ります。この記録に呼び名と電話番号は入っていません。</li>
          <li>保存の期間は定めていません。大会の期間中だけ動かします。</li>
        </ul>
      </section>

      <section aria-labelledby="privacy-appi-head">
        <h2 id="privacy-appi-head">個人情報保護法にもとづく公表事項</h2>
        <ul>
          <li>事業者: イマセキの運営者（名称・住所・代表者は準備中です。下の連絡先へお問い合わせください）</li>
          <li>利用目的: 上の表の「何のため」のとおりです。</li>
          <li>開示・訂正・利用停止・消去の求め: 下の連絡先へメールでお知らせください。ご本人であることを確かめたうえで応じます。消去は画面からもできます。</li>
          <li>苦情・問い合わせの申出先: 下の連絡先</li>
          <li>安全管理: 客の識別子は端末の Cookie に置き、サーバーには変換した値だけを保存します。電話番号を店の画面に出すのは、その客が席を確保した店だけです。運営の画面と AI には、客の呼び名と電話番号を渡しません。</li>
        </ul>
        <p>
          連絡先: <ContactEmail />
        </p>
      </section>
    </main>
  );
}
