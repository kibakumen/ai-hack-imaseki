// 公開（`pnpm run deploy`）の歯止め（2026-09-26・本人の依頼「安全のために一旦デプロイは止めて」）。
//
// 公開は 2026-09-25 から止めてある（README の「6.1 今は止めてある」）。止めたのが管理画面の手だけだと、
// `pnpm --dir web run deploy` を1回流すだけで公開が戻り、同時に本番の D1 へ migration が当たる。
// そこで deploy の最初の手順をこの歯止めにし、明示の合図（ALLOW_DEPLOY=1）が無ければ何もせずに失敗で止める。
// 再開の手順（README 6.2）を踏んだ人だけが、合図を付けて流す。
//
// 2026-09-26 本人選択（AI提示）: 事業者の名称・住所は公開を再開するまで「準備中」のまま置く。合図があっても、
// /privacy と利用規約の事業者の表記が「準備中」のまま（正本 lib/domain/texts.ts の OPERATOR_IDENTITY が空）なら止める。
// 3つのページが正本の表記（components/ui/OperatorIdentity）を使っていることも確かめる（ページに自分で書いた「準備中」を見落とさない）。
//
// ⚠️ この歯止めは package.json の deploy だけを止める。`wrangler deploy` を直に打つ道は止めない——
//    そちらは wrangler.jsonc の `workers_dev: false`・`preview_urls: false` が、公開の道を黙って戻さない。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const OPERATOR_SOURCE = "lib/domain/texts.ts";
const OPERATOR_FIELDS = ["name", "address", "representative"];
const OPERATOR_PAGES = ["app/privacy/page.tsx", "app/terms/page.tsx", "app/store/terms/page.tsx"];

/**
 * 事業者の表記が公開してよい形かを確かめ、足りないものを文で返す（空なら公開してよい）。
 * 正本の `OPERATOR_IDENTITY` の宣言を文字として読む（組み立ての前に走るため）。読めないときも足りないものとして返す。
 */
export const operatorIdentityProblems = (webRoot) => {
  const problems = [];
  const sourcePath = path.join(webRoot, OPERATOR_SOURCE);
  const source = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, "utf8") : "";
  const declaration = source.match(/export const OPERATOR_IDENTITY\b[^=]*=\s*\{([^}]*)\}/);
  if (!declaration) {
    problems.push(`${OPERATOR_SOURCE} の OPERATOR_IDENTITY が読めません（文字列のリテラルで書いてください）`);
  } else {
    for (const field of OPERATOR_FIELDS) {
      const value = declaration[1].match(new RegExp(`\\b${field}\\s*:\\s*"([^"]*)"`));
      if (!value || value[1].trim() === "") problems.push(`${OPERATOR_SOURCE} の OPERATOR_IDENTITY.${field} が空です（画面は「準備中」のまま）`);
    }
  }
  for (const page of OPERATOR_PAGES) {
    const pagePath = path.join(webRoot, page);
    const text = fs.existsSync(pagePath) ? fs.readFileSync(pagePath, "utf8") : "";
    if (!text.includes("<OperatorIdentity")) problems.push(`${page} が事業者の表記（components/ui/OperatorIdentity）を使っていません`);
  }
  return problems;
};

const main = () => {
  if (process.env.ALLOW_DEPLOY !== "1") {
    console.error(
      [
        "公開は止めてあります（2026-09-25 から・README の「6.1 今は止めてある」）。",
        "再開するときは README の「6.2 再開の手順」を順に踏み、最後に次の形で流してください:",
        "  ALLOW_DEPLOY=1 pnpm --dir web run deploy",
        "（本番の D1 へ migration を当ててから公開します。合図が無いので、何もせずに止めました）",
      ].join("\n"),
    );
    process.exit(1);
  }
  const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const problems = operatorIdentityProblems(webRoot);
  if (problems.length > 0) {
    console.error(
      [
        "事業者の表記が「準備中」のままなので、公開を止めました（2026-09-26 本人選択: 公開を再開するまで準備中のまま置く）。",
        ...problems.map((problem) => `  - ${problem}`),
        "README の「6.2 再開の手順」の「事業者の表記を埋める」を済ませてから、もう一度流してください。",
      ].join("\n"),
    );
    process.exit(1);
  }
};

// 検査が確かめの関数だけを読み込むときは走らせない（node で直に流したときだけ走る）
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) main();
