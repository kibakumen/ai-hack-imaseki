// Next.js の Route Handler と、入口の束ね役（lib/http/app）をつなぐ橋。
//
// `app/api/**/route.ts` はこのファイルだけを読む。理由は依存の向き——構造の検査
// （`tests/acceptance/v2/structure.test.ts` の「依存の向き」）は `web/app/**` の全部を歩いて、
// `lib/http`・`lib/adapters`・`lib/usecases`・`lib/repo` を値として読んでいないことを見る。
// `app/api/**` も `web/app/**` の中なので、route.ts は `lib/http/app` を直接は読めない。
// 橋をここに1本だけ置き、route.ts の中身は「この関数を GET／POST として名乗る」だけにする。

import { createDeps } from "./adapters/deps";
import { loadWorkerEnv } from "./adapters/env";
import { createApp } from "./http/app";

/**
 * 要求を1つ捌く。経路の当て（動的な区間を含む）は `lib/http/app` の `ROUTE_DEFINITIONS` が持つので、
 * route.ts の置き場所と Next.js が渡す `params` は見ない（入口の一覧の正本は1つ）。
 */
export const app = async (req: Request): Promise<Response> => createApp(createDeps(await loadWorkerEnv())).fetch(req);
