// Worker の入口（2026-09-26・wrangler.jsonc の main）。OpenNext が組み立てた Worker（.open-next/worker.js）に、
// 定期実行の入口 scheduled を足すだけの薄い包み。
//
// 形は OpenNext の公式の手順「Custom Worker」（https://opennext.js.org/cloudflare/howtos/custom-worker）どおり:
// 組み立てた Worker の既定の書き出しから fetch をそのまま渡し、scheduled を足して、wrangler.jsonc の main をこの
// ファイルへ向ける。.open-next/worker.js は `opennextjs-cloudflare build` のときにできる（git には入らない）。
// Durable Object の書き出しし直しは、DO のキューとタグのキャッシュを使うときだけ要る（この製品は使っていない）。
//
// 定期実行は wrangler.jsonc の triggers.crons（1日1回）が起こし、lib/scheduled の runScheduledJobs を呼ぶ——
// Google で直した店の座標のうち、連続30日を過ぎたものを必ず消す（Service Specific Terms 6.3.1）。
// .mjs にしているのは、型検査（tsconfig は .ts・.tsx だけ）が組み立てのときにしか無い .open-next/worker.js を
// 読みに行かないようにするため。lib/scheduled（.ts）は wrangler の束ね（esbuild）がそのまま読む。

import openNextWorker from "./.open-next/worker.js";
import { runScheduledJobs } from "./lib/scheduled";

const worker = {
  fetch: openNextWorker.fetch,
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(runScheduledJobs(env));
  },
};

export default worker;
