// 公開（`pnpm run deploy`）の歯止め（2026-09-26・本人の依頼「安全のために一旦デプロイは止めて」）。
//
// 公開は 2026-09-25 から止めてある（README の「6.1 今は止めてある」）。止めたのが管理画面の手だけだと、
// `pnpm --dir web run deploy` を1回流すだけで公開が戻り、同時に本番の D1 へ migration が当たる。
// そこで deploy の最初の手順をこの歯止めにし、明示の合図（ALLOW_DEPLOY=1）が無ければ何もせずに失敗で止める。
// 再開の手順（README 6.2）を踏んだ人だけが、合図を付けて流す。
//
// ⚠️ この歯止めは package.json の deploy だけを止める。`wrangler deploy` を直に打つ道は止めない——
//    そちらは wrangler.jsonc の `workers_dev: false`・`preview_urls: false` が、公開の道を黙って戻さない。

const ALLOWED = process.env.ALLOW_DEPLOY === "1";

if (!ALLOWED) {
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
