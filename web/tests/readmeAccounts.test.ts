// README（公開のリポジトリ）とアカウントの守り（2026-09-25 監査の指摘 安全-01 のレビュー）。
//
//   - ログインの値（メールアドレスとパスワードの組・共通のパスワード）を載せない。載っていた値で、誰でも
//     運営として入り、パスワードとメールアドレスを変えて本人と審査員を締め出せた。値は公開されない経路で渡す
//   - 乗っ取られた運営を取り返す手順（seed-admin の一覧・--account-id・--add）が手順書から辿れる
//   - Turnstile の試験用の鍵（必ず通る）を本番に入れない、と書いてある（adapters/turnstile.ts の注が指す一文）

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const README = fs.readFileSync(path.resolve(__dirname, "..", "..", "README.md"), "utf8");
const DUMMY_DATA = fs.readFileSync(path.resolve(__dirname, "..", "..", "docs", "dummy-data.md"), "utf8");

/** `<email>` / `<値>` の形（ログインの値の組）。`<16字以上>` のような置き場所の印は値ではないので除く。 */
const CREDENTIAL_PAIR = /`[^`\s]+@[^`\s]+`\s*\/\s*`(?!<)[^`]+`/;
/**
 * 「パスワードは共通 `…`」「パスワード: `…`」のように、パスワードの値そのものを書いた形。
 * `<16字以上>` のような置き場所の印と、`--store-password` のようなスクリプトの指定は値ではないので除く。
 */
const PASSWORD_VALUE = /パスワード[^\n`]{0,12}`(?![<-])[^`\s]{8,}`/;

const sectionOf = (doc: string, heading: string): string => {
  const start = doc.indexOf(heading);
  if (start < 0) return "";
  const next = doc.indexOf("\n### ", start + heading.length);
  return doc.slice(start, next < 0 ? undefined : next);
};

describe("README とアカウントの守り", () => {
  for (const [name, doc] of [
    ["README.md", README],
    ["docs/dummy-data.md", DUMMY_DATA],
  ] as const) {
    it(`${name} にログインの値（メールアドレスとパスワードの組・パスワードの値）を載せない`, () => {
      expect(doc).not.toMatch(CREDENTIAL_PAIR);
      expect(doc).not.toMatch(PASSWORD_VALUE);
    });
  }

  it("README の seed-admin の節に、乗っ取られた運営を取り返す手順（今いる運営の一覧・--account-id・--add）が在る", () => {
    const section = sectionOf(README, "### 5.3");
    expect(section).toContain("--account-id");
    expect(section).toContain("--add");
    expect(section).toMatch(/今いる運営/);
    expect(section).toMatch(/セッションを全部切/);
  });

  // 2026-09-26 のレビュー: デモ店の入れ替えの文を README に二重引用で書いていたので、貼った bash が保存の値の `$` を
  // 展開して壊れた値が本番に入った。保存の値を運ぶ文は、手で書かずにスクリプトの `--print`（単一引用）から出す。
  it("README は、パスワードの保存の値を二重引用の --command で流させない。デモ店の入れ替えは seed-demo の --rotate-stores から出す", () => {
    expect(README).not.toMatch(/--command "[^"\n]*password_hash/);
    const section = sectionOf(README, "#### 本番のデモ店のパスワードを入れ替えるとき");
    expect(section).toContain("--rotate-stores");
    expect(section).toContain("--print");
  });

  // 秘密鍵の名前そのものは adapters の外に書かない（structure.test.ts の約束）ので、名前の後ろ半分で見る。
  it("README に、Turnstile の試験用の鍵を本番の秘密鍵に入れない、と書いてある", () => {
    expect(README).toMatch(/試験用の鍵[^\n]*本番の[^\n]*_SECRET_KEY`?[^\n]*入れない/);
  });
});
