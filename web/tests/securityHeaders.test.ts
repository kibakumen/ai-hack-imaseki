// セキュリティ用の応答の見出し（2026-09-25 監査の指摘 安全-24）。
//
// 受け入れ検査 structure の「応答の見出し」は、全部の経路に5つの見出しが在ることだけを見る。ここは
// **その見出しが画面を壊さない**ことを見る——CSP を締めすぎると、Turnstile が読めずに登録もログインも
// できなくなり、Next の実行時のインラインスクリプトが止まって画面が立ち上がらない（どちらも手元の検査では
// 気づけず、公開して初めて分かる壊れ方）。画面が実際に読むものを1つずつ当てる。

import { describe, expect, it } from "vitest";
import nextConfig, { contentSecurityPolicy, securityHeaders } from "../next.config";
import { TURNSTILE_SCRIPT_URL } from "../components/ui/HumanCheck";

/** CSP の文字列を「指令 → 値の並び」へ。 */
const parseCsp = (policy: string): Map<string, string[]> =>
  new Map(
    policy
      .split(";")
      .map((part) => part.trim().split(/\s+/))
      .filter((tokens) => tokens[0] !== "")
      .map(([name, ...values]) => [name.toLowerCase(), values]),
  );

/** その指令（無ければ default-src）の値。ブラウザと同じ倒し方。 */
const sourcesFor = (csp: Map<string, string[]>, directive: string): string[] => csp.get(directive) ?? csp.get("default-src") ?? [];

const production = parseCsp(contentSecurityPolicy({ dev: false }));
const development = parseCsp(contentSecurityPolicy({ dev: true }));

describe("CSP が画面の読むものを許している（安全-24）", () => {
  it("Turnstile の読み込み（script）と、確かめの枠（frame）を許す", () => {
    const origin = new URL(TURNSTILE_SCRIPT_URL).origin;
    expect(sourcesFor(production, "script-src")).toContain(origin);
    expect(sourcesFor(production, "frame-src")).toContain(origin);
  });

  it("インラインスクリプト（Next の実行時の流し込み・明暗の初期化）を止めない: 'unsafe-inline' を持ち、それを無効にする nonce や hash を混ぜない", () => {
    // nonce か hash が1つでも在ると、ブラウザは 'unsafe-inline' を無視する（CSP2 以降）。nonce を配る仕組み（proxy と
    // 動的な描画）を入れないまま足すと、Next の `self.__next_f.push(…)` が全部止まる。
    const script = sourcesFor(production, "script-src");
    expect(script).toContain("'unsafe-inline'");
    expect(script.filter((s) => /^'(nonce|sha256|sha384|sha512)-/.test(s))).toEqual([]);
    expect(script).toContain("'self'");
  });

  it("本番では eval を許さず、手元の開発でだけ許す（React の開発時の仕組みが使う）。開発では HMR の WebSocket も許す", () => {
    expect(sourcesFor(production, "script-src")).not.toContain("'unsafe-eval'");
    expect(sourcesFor(development, "script-src")).toContain("'unsafe-eval'");
    expect(sourcesFor(development, "connect-src")).toContain("ws:");
    expect(production.has("upgrade-insecure-requests")).toBe(true);
    // 手元の http://localhost で部品の読み込みを https へ上げると、開発の画面が壊れる
    expect(development.has("upgrade-insecure-requests")).toBe(false);
  });

  it("画面が読む同じオリジンのもの（入口・店の画像・Service Worker・style の属性）を許す", () => {
    expect(sourcesFor(production, "connect-src")).toContain("'self'");
    expect(sourcesFor(production, "img-src")).toEqual(expect.arrayContaining(["'self'", "data:", "blob:"]));
    expect(sourcesFor(production, "worker-src")).toContain("'self'");
    // React の style={{…}} は描いた HTML に style 属性として出る
    expect(sourcesFor(production, "style-src")).toEqual(expect.arrayContaining(["'self'", "'unsafe-inline'"]));
  });

  it("運営が開く営業許可書（PDF）を、ブラウザの表示部品で開ける（object-src を 'none' にしない）", () => {
    // 見出しは全部の経路に付くので、PDF の応答にも同じ CSP が付く。Chrome の PDF の表示部品は object-src で止まる。
    expect(sourcesFor(production, "object-src")).toContain("'self'");
  });

  it("よそのページに枠で埋め込ませず、base と送り先を自分に閉じる", () => {
    expect(production.get("frame-ancestors")).toEqual(["'none'"]);
    expect(production.get("base-uri")).toEqual(["'self'"]);
    expect(production.get("form-action")).toEqual(["'self'"]);
  });
});

describe("ほかの見出し（安全-24）", () => {
  const byKey = (dev: boolean) => new Map(securityHeaders({ dev }).map((h) => [h.key.toLowerCase(), h.value]));

  it("クリックジャッキング・種類の読み替え・参照元の漏れを止める値", () => {
    const headers = byKey(false);
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    // よそへは origin だけ（Turnstile の枠は解いた場所の確かめに使う）。パスや問い合わせ文字列は渡さない
    expect(headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  });

  it("Permissions-Policy は、客の画面が使う位置（自分のオリジンだけ）を残し、使わないカメラ・マイクを閉じる", () => {
    const policy = byKey(false).get("permissions-policy") ?? "";
    expect(policy).toContain("geolocation=(self)");
    expect(policy).toContain("camera=()");
    expect(policy).toContain("microphone=()");
  });

  it("next.config は X-Powered-By を出さず、全部の経路に同じ見出しを付ける", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    const rules = (await nextConfig.headers?.()) ?? [];
    const everyPath = rules.find((r) => r.source === "/(.*)");
    expect(everyPath?.headers.map((h) => h.key.toLowerCase()).sort()).toEqual(securityHeaders({ dev: false }).map((h) => h.key.toLowerCase()).sort());
  });
});
