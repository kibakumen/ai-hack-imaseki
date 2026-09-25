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
// だから「形」と「指紋（sha256）」で見る。指紋は、公開中の履歴に既に平文である速成版の鍵のものだけを置く（新しく漏れるものは無い）。
// 見張る語の一部（パスの形）は、この検査のファイル自身に当たらないよう正規表現の中でだけ書く。
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const REPO = path.resolve(__dirname, "..", "..");
const SELF = path.relative(REPO, __filename).split(path.sep).join("/");
/** git と同じ見分け方（`git grep -I`）: 先頭 8000 バイトに NUL があればバイナリ。拡張子で絞ると `.sh` や拡張子の無いファイルを見落とす */
const BINARY_SNIFF_BYTES = 8000;

const tracked = execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
const trackedSet = new Set(tracked);
/** 公開するテキストのファイルの中身（依存の型の宣言 `*.d.ts` は外の生成物なので除く）。この検査のファイル自身も除く。 */
const publicTexts: ReadonlyMap<string, string> = new Map(
  tracked
    .filter((f) => !f.endsWith(".d.ts") && f !== SELF && fs.statSync(path.join(REPO, f), { throwIfNoEntry: false })?.isFile())
    .map((f) => [f, fs.readFileSync(path.join(REPO, f))] as const)
    .filter(([, bytes]) => !bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0))
    .map(([f, bytes]) => [f, bytes.toString("utf8")] as const),
);
const publicTextFiles = [...publicTexts.keys()];
const read = (rel: string): string => publicTexts.get(rel) ?? fs.readFileSync(path.join(REPO, rel), "utf8");

/** リポジトリの外の私的な場所を指すパスの形（OS のユーザー名を含む絶対パス・vault・開発ハーネス） */
const PRIVATE_PATH_SHAPES: readonly RegExp[] = [
  /\/home\/[a-z_][\w.-]*\//,
  /\/Users\/[\w.-]+\//,
  /~\/vault\b/,
  /~\/\.claude\b/,
  /~\/src\/[\w.-]+\//,
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
/** 鍵をクエリに載せた URL の形（速成版の店の入口は `/store?key=…`）。`<…>`・`…` の置き場所の印は値ではない */
const KEY_QUERY_SHAPE = /[?&]key=(?![<…])[^\s&"'`)<]+/;

/** JSON の中の文字列の欄を全部（引用の quote だけでなく、指摘の本文・直し方・注も） */
const collectStrings = (node: unknown): string[] => {
  if (typeof node === "string") return [node];
  if (Array.isArray(node)) return node.flatMap(collectStrings);
  if (node === null || typeof node !== "object") return [];
  return Object.values(node).flatMap(collectStrings);
};
const auditStrings: ReadonlyArray<{ readonly file: string; readonly text: string }> = auditFiles.flatMap((file) =>
  collectStrings(JSON.parse(read(file))).map((text) => ({ file, text })),
);

/**
 * 速成版（d97e989 の sprint/）の店の鍵5本と、運営の鍵の既定値の sha256（安全-05）。
 * 値は公開中の履歴に平文で残っている（履歴は書き換えない・本人選択）ので、指紋を置いても新しく漏れるものは無い。
 * 値そのものはこのファイルに書かない。
 */
const LEAKED_SPRINT_KEY_SHA256: ReadonlySet<string> = new Set([
  "9a641a1433c69b96284b1ea0befaa5b8dc841ed7a965c716abc34bd34d23f14b",
  "753045ccdee3427217edbc43ab3a14b5df695e430d7556b3bef490e28ef99674",
  "83d787268544d30e696e5040a3a9dd1bd820bd627f83d7bc6819b5595b1287cb",
  "c044dc67d9bb9ae0fd98719ba2f7f575b45976c0f79ea4c10ba50f68b3ebd4a7",
  "919dd3c667c0174bc9a4a4bd5b20c70cd2f25cfae6880dabe6779000245c8272",
  "87703a2a2113695c9a552a815920f3ef2baafb6e7e8f791c1956a362e116fbdf",
]);
const SPRINT_KEYS_COMMIT = "d97e989160605b8ec83ea0007054f5d6c232e288";
/** 鍵の値はどれも英小文字・数字・ハイフンだけでできている。候補は、その文字の続きを区切りの位置で切り出したもの */
const KEY_CHAR_RUN = /[a-z0-9-]+/g;
const KEY_CANDIDATE_MIN = 6;
const KEY_CANDIDATE_MAX = 32;

const sha256 = (text: string): string => crypto.createHash("sha256").update(text).digest("hex");

/** ハイフンで区切った並びの、連続する部分のすべて（`a-b-c` なら a・b・c・a-b・b-c・a-b-c）。前後の語と繋がって書かれても拾う */
const hyphenSpans = (run: string): string[] => {
  const parts = run.split("-");
  return parts.flatMap((_, start) => parts.slice(start).map((__, len) => parts.slice(start, start + len + 1).join("-")));
};

const keyCandidates = (text: string): ReadonlySet<string> =>
  new Set(
    [...text.matchAll(KEY_CHAR_RUN)]
      .flatMap((match) => hyphenSpans(match[0]))
      .filter((c) => c.length >= KEY_CANDIDATE_MIN && c.length <= KEY_CANDIDATE_MAX),
  );

/** 失敗の表示に値を出さないよう、見つかった数だけを返す */
const countLeakedKeys = (text: string): number => [...keyCandidates(text)].filter((c) => LEAKED_SPRINT_KEY_SHA256.has(sha256(c))).length;

const gitShowOrNull = (spec: string): string | null => {
  try {
    return execFileSync("git", ["show", spec], { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
};
const historicSprintKeyFiles = [gitShowOrNull(`${SPRINT_KEYS_COMMIT}:sprint/scripts/seed.mjs`), gitShowOrNull(`${SPRINT_KEYS_COMMIT}:sprint/lib/db.ts`)];

describe("公開の文書: 速成版の鍵（安全-05）", () => {
  it("監査記録は、速成版のファイルから鍵の値（`key: \"…\"`・既定値 `?? \"…\"`・`?key=…`）を引用しない", () => {
    const leaks = evidence.filter((e) => e.path.startsWith("sprint/") && (LITERAL_SECRET_SHAPE.test(e.quote) || KEY_QUERY_SHAPE.test(e.quote)));
    expect(leaks.map((e) => `${e.file}: ${e.path}`)).toEqual([]);
  });

  it("監査記録のどの文字列の欄にも（引用の quote 以外の本文・直し方・注も）、鍵をクエリに載せた URL の形（`?key=…`）が無い", () => {
    const hits = auditStrings.filter((s) => KEY_QUERY_SHAPE.test(s.text)).map((s) => s.file);
    expect(hits).toEqual([]);
  });

  it("追跡しているどのテキストのファイルにも、速成版の店の鍵・運営の鍵の値そのもの（指紋で照合）が無い", () => {
    const hits = publicTextFiles.filter((f) => countLeakedKeys(read(f)) > 0);
    expect(hits).toEqual([]);
  });

  // 指紋の一覧が本物の鍵と合っていることの確かめ。履歴を持たない浅い clone では飛ばす
  it.skipIf(historicSprintKeyFiles.includes(null))("見張りの指紋は、履歴の速成版に入っていた鍵（店5本・運営の既定値）を全部拾える", () => {
    expect(countLeakedKeys(historicSprintKeyFiles.join("\n"))).toBe(LEAKED_SPRINT_KEY_SHA256.size);
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

  // 2026-09-26 のレビュー（安全-27 の案A の残り）: パスは伏せたが、本人の手元の私的な文書のファイル名（番号つきの .md の名前）が
  // 仕様と監査記録に残っていた。置き場所の手がかりになるので、中立の名札（本人の注文メモ（v2）・チームの設計案（v1）など）に置き換えた。
  it("追跡しているどのファイルにも、本人の手元の私的な文書のファイル名（番号つきの .md の名前）が無い", () => {
    const PRIVATE_DOC_NAME = /(?<![0-9A-Za-z_])(0[1-9]|1[0-9])_[^\s`'"()（）/]*\.md\b/;
    const PRIVATE_DOC_STEM = /(?<![0-9A-Za-z_])0[1-7]_(v2の注文|要件|題材と注文|チームの|議事録|決定台帳|鍵と環境|AI開発フロー|dev最小版)/;
    const hits = publicTextFiles.filter((f) => PRIVATE_DOC_NAME.test(read(f)) || PRIVATE_DOC_STEM.test(read(f)));
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
  // 予算額は「予算」の近くのドルの額で見る（コードには 1回の実測の費用や正規表現の `$1` があり、ドルの額だけでは見分けられない）。
  const DETAIL_SHAPES: readonly RegExp[] = [
    /\bAIHACK\b/,
    /\$\s?\d+(\.\d+)?\s*\/\s*日/,
    /1日\d+ドル/,
    /予算[^。\n]{0,30}\$\s?\d/,
    /拒否リスト/,
    /脱獄/,
    /有効期限は管理画面で設定できず/,
  ];

  it("公開の文書（README・docs/）にも、コード（web/ のコメント）にも、Guardrails のルールの一覧・鍵の名前・1日の予算額・期限が無いことを書かない", () => {
    expect(publicTextFiles).toContain("README.md");
    expect(publicTextFiles.some((f) => f.startsWith("web/lib/"))).toBe(true);
    const hits = publicTextFiles.flatMap((f) => {
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
