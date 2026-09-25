import type { NextConfig } from "next";

// セキュリティ用の応答の見出し（2026-09-25 監査の指摘 安全-24）。それまで1つも無く、この先1か所でも
// XSS が入ったときに止める層が無かった。全部の経路（画面も入口も）に同じ見出しを付ける。
//
// CSP は「画面が実際に読むもの」だけを許す形にした。許しているものと理由:
//   - script-src 'unsafe-inline': Next（App Router）は実行時にインラインのスクリプト（`self.__next_f.push(…)`）を
//     流し込み、明暗の初期化（app/layout.tsx）もインラインで走る。nonce で締めるには proxy で要求ごとに nonce を
//     作り、全部の画面を動的に描く必要がある（Next の手引き「Without Nonces」の形をまず入れた・AI判断）。
//     ⚠️ nonce か hash を1つでも足すとブラウザは 'unsafe-inline' を無視し、画面が立ち上がらなくなる
//     （web/tests/securityHeaders.test.ts が見張る）。
//   - challenges.cloudflare.com: Turnstile の読み込み（script）と確かめの枠（frame）。Cloudflare の手引きの2つ。
//   - style-src 'unsafe-inline': React の style={{…}} は描いた HTML に style 属性として出る。
//   - img-src data: blob:: 画面の小さな図（data: URI）。店の画像は同じオリジンの入口から読む。
//   - object-src 'self': 運営が開く営業許可書（PDF）を、ブラウザの表示部品で開けるように（'none' だと Chrome が止める）。
//   - 開発（next dev）だけ: React の開発時の仕組みが使う eval と、HMR の WebSocket（ws:）。
//     upgrade-insecure-requests は本番だけ（手元の http://localhost の読み込みを https へ上げると開発の画面が壊れる）。

type Header = { key: string; value: string };

const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/** CSP の値。`dev` は next dev のときだけ true。 */
export const contentSecurityPolicy = ({ dev }: { dev: boolean }): string =>
  [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' ${TURNSTILE_ORIGIN}${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${dev ? " ws:" : ""}`,
    `frame-src ${TURNSTILE_ORIGIN}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");

/** 全部の経路に付ける見出し。 */
export const securityHeaders = ({ dev }: { dev: boolean }): Header[] => [
  { key: "Content-Security-Policy", value: contentSecurityPolicy({ dev }) },
  // 古いブラウザ向けの枠の禁止（新しいブラウザは CSP の frame-ancestors を見る）
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // よそへは origin だけを渡す（パス・問い合わせ文字列に載る番号を渡さない）。'no-referrer' にしないのは、
  // Turnstile の枠が解かれた場所の確かめに参照元を使う可能性があるため（確かめていない・安全側に残した）
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 客の画面は位置を使う（自分のオリジンだけ）。ほかの強い機能は使わないので閉じる
  { key: "Permissions-Policy", value: "geolocation=(self), camera=(), microphone=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  // 使っている組み立て（Next.js）を名乗らない
  poweredByHeader: false,
  headers: async () => [{ source: "/(.*)", headers: securityHeaders({ dev: process.env.NODE_ENV === "development" }) }],
};

export default nextConfig;
