// 公開のリポジトリに載せる文書の見張り（2026-09-25 監査の指摘 安全-05・安全-25・安全-26・安全-27、安全-01 の README の部分）。
//
//   - 安全-05: 速成版（sprint/）の店の鍵と運営の鍵の既定値が、監査記録の引用に平文で残っていた。速成版の公開先の URL も
//     文書に載っていた（鍵が効く場所を指し示す）
//   - 安全-25: AI まわりの守りの中身（Guardrails のルールの一覧・鍵の名前・1日の予算額）が公開の文書に細かく書かれていた
//   - 安全-26・安全-27: 監査記録が、リポジトリの外の私的な文書（本人の注文メモ・チームの打ち合わせの議事録・メンバーの資料・
//     開発ハーネスの内部）を原文のまま引用し、OS のユーザー名を含む絶対パスと vault の構成を載せていた
//   - 安全-01（README の部分）: デモは止めたので、README が公開中のデモとして URL を案内しない
//
// ⚠️ この検査は、見張る値そのもの（鍵の値）を持たない。値を書くと、この検査が公開のリポジトリに値を載せ直すことになる。
// だから値ではなく「形」で見る。見張る語の一部（パスの形）は、この検査のファイル自身に当たらないよう正規表現の中でだけ書く。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO = path.resolve(__dirname, "..", "..");
const SELF = path.relative(REPO, __filename).split(path.sep).join("/");
const TEXT_FILE = /\.(ts|tsx|js|mjs|json|jsonc|sql|md|toml|yaml|yml|txt|css|html|example)$/;

const tracked = execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
const trackedSet = new Set(tracked);
const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), "utf8");
/** 公開する文書（依存の型の宣言 `*.d.ts` は外の生成物なので除く）。この検査のファイル自身も除く。 */
const publicTextFiles = tracked.filter((f) => TEXT_FILE.test(f) && !f.endsWith(".d.ts") && f !== SELF && fs.existsSync(path.join(REPO, f)));

/** リポジトリの外の私的な場所を指すパスの形（OS のユーザー名を含む絶対パス・vault・開発ハーネス） */
const PRIVATE_PATH_SHAPES: readonly RegExp[] = [
  /\/home\/[a-z_][\w.-]*\//,
  /\/Users\/[\w.-]+\//,
  /~\/vault\b/,
  /~\/\.claude\b/,
  /(^|[\s`'"(（/])vault\/knowledge\//,
  /(^|[\s`'"(（/])knowledge\/(projects|models)\//,
  /(^|[\s`'"(（/~])\.claude\/(skills|state)\//,
];

/** 監査記録の引用を伏せた印。伏せたものは、この印の文だけを持つ */
const REDACTED_QUOTE = /^（伏せた: /;
/** リポジトリの外の文書を指していた引用の、置き換えた先の名札 */
const PRIVATE_LABEL = /^（非公開）/;

interface Evidence {
  readonly file: string;
  readonly path: string;
  readonly quote: string;
}

const auditFiles = tracked.filter((f) => /^docs\/specs\/[^/]+\/audits\/[^/]+\.json$/.test(f));

const collectEvidence = (file: string, node: unknown): Evidence[] => {
  if (Array.isArray(node)) return node.flatMap((child) => collectEvidence(file, child));
  if (node === null || typeof node !== "object") return [];
  const record = node as Record<string, unknown>;
  const own = typeof record.path === "string" && typeof record.quote === "string" ? [{ file, path: record.path, quote: record.quote }] : [];
  return [...own, ...Object.values(record).flatMap((child) => collectEvidence(file, child))];
};

const evidence: Evidence[] = auditFiles.flatMap((f) => collectEvidence(f, JSON.parse(read(f))));

/** 引用の元として許すもの: 追跡しているファイル・/dev の作業記録（.dev/）・公開の依存（node_modules/）・速成版（sprint/。鍵は下で見る） */
const isAllowedSource = (p: string): boolean =>
  trackedSet.has(p) || p.startsWith(".dev/") || p.startsWith("node_modules/") || p.startsWith("sprint/") || PRIVATE_LABEL.test(p);

/** 文字列の値を代入・既定値にしている形（`key: "…"`・`?? "…"`）。`<…>` の置き場所の印は値ではない */
const LITERAL_SECRET_SHAPE = /(\bkey\s*:\s*|\?\?\s*)["'](?!<)[^"']+["']/;

describe("公開の文書: 速成版の鍵（安全-05）", () => {
  it("監査記録は、速成版のファイルから鍵の値（`key: \"…\"`・既定値 `?? \"…\"`）を引用しない", () => {
    const leaks = evidence.filter((e) => e.path.startsWith("sprint/") && LITERAL_SECRET_SHAPE.test(e.quote));
    expect(leaks.map((e) => `${e.file}: ${e.path}`)).toEqual([]);
  });

  it("運営の鍵を既定値つきで読む形（`ADMIN_KEY ?? \"…\"`）が、追跡しているどのファイルにも無い", () => {
    const hits = publicTextFiles.filter((f) => /ADMIN_KEY\s*\?\?\s*\\?["'](?!<)/.test(read(f)));
    expect(hits).toEqual([]);
  });

  it("速成版の公開先の URL を載せない（古い鍵が効く場所を指し示さない）", () => {
    const hits = publicTextFiles.filter((f) => /ai-hack-sekiari\.[\w-]+\.workers\.dev/.test(read(f)));
    expect(hits).toEqual([]);
  });
});

describe("公開の文書: 私的な文書と開発ハーネスの内部（安全-26・安全-27）", () => {
  it("追跡しているどのファイルにも、OS のユーザー名を含む絶対パス・vault の構成・開発ハーネスの内部のパスが無い", () => {
    const hits = publicTextFiles.flatMap((f) => {
      const text = read(f);
      return PRIVATE_PATH_SHAPES.filter((re) => re.test(text)).map((re) => `${f}: ${re}`);
    });
    expect(hits).toEqual([]);
  });

  it("監査記録の引用の元は、このリポジトリのファイルか、伏せた名札（（非公開）…）のどちらか", () => {
    const outside = evidence.filter((e) => !isAllowedSource(e.path));
    expect(outside.map((e) => `${e.file}: ${e.path}`)).toEqual([]);
  });

  it("リポジトリの外の文書（本人の注文メモ・議事録・メンバーの資料・開発ハーネス）からの引用は、伏せた印の文だけを持つ", () => {
    const privateQuotes = evidence.filter((e) => PRIVATE_LABEL.test(e.path));
    expect(privateQuotes.length).toBeGreaterThan(0);
    const unredacted = privateQuotes.filter((e) => !REDACTED_QUOTE.test(e.quote));
    expect(unredacted.map((e) => `${e.file}: ${e.path}`)).toEqual([]);
  });
});

describe("公開の文書: AI まわりの守りの中身（安全-25）", () => {
  // 守りがあること・弾かれたら点数順に倒れることは書いてよい。書かないのは、避け方の手引きになる中身（ルールの一覧）と、
  // 食い潰しの目安になる中身（鍵の名前・1日の予算額・期限が無いこと）。
  const DETAIL_SHAPES: readonly RegExp[] = [/\bAIHACK\b/, /\$\s?\d+(\.\d+)?\s*\/\s*日/, /1日\d+ドル/, /拒否リスト/, /脱獄/, /有効期限は管理画面で設定できず/];

  it("公開の文書（README・docs/）に、Guardrails のルールの一覧・鍵の名前・1日の予算額・期限が無いことを書かない", () => {
    const docs = publicTextFiles.filter((f) => f === "README.md" || f.startsWith("docs/"));
    expect(docs.length).toBeGreaterThan(0);
    const hits = docs.flatMap((f) => {
      const text = read(f);
      return DETAIL_SHAPES.filter((re) => re.test(text)).map((re) => `${f}: ${re}`);
    });
    expect(hits).toEqual([]);
  });
});

describe("公開の文書: デモは止めてある（安全-01 の README の部分）", () => {
  const README = read("README.md");
  const touchSection = README.slice(README.indexOf("## 1. 触れる場所"), README.indexOf("\n## 2."));

  it("README の「1. 触れる場所」は、デモを止めてあることを書き、公開先の URL を触れる場所として案内しない", () => {
    expect(touchSection).toMatch(/停止/);
    expect(touchSection).not.toMatch(/^https:\/\/\S+\.workers\.dev\s*$/m);
  });

  it("README は、公開先を「公開中」と書かない", () => {
    expect(README).not.toMatch(/workers\.dev\S*\s*で公開中/);
  });
});
