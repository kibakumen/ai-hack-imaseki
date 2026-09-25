// 入口の束ね役（設計書「実行者への契約」）。createApp(deps) は deps を呼ばれるたびに読む
// （作った時に分解して閉じ込めない）。routes は全部の入口を載せる（横断の検査がこれを歩く）。

import type { Deps, Logger } from "../ports";
import { notFound } from "./refusals";
import { internalError } from "./unhandled";
import { ROUTE_DEFINITIONS } from "./routes";

export type RouteInfo = { method: string; path: string; auth: string; human: boolean };
export type App = { fetch(req: Request): Promise<Response>; routes: RouteInfo[] };

/** 動的な区間の percent 符号を解く。壊れていれば null（decodeURIComponent は投げるので、ここで受ける）。 */
const decodeSegment = (raw: string): string | null => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
};

const matchPath = (pattern: string, pathname: string): Record<string, string> | null => {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const p = patternParts[i];
    const v = pathParts[i];
    if (p.startsWith(":")) {
      // 壊れた区間はこの入口に当てない＝どの入口にも当たらず 404 になる（落ちない・要件29）。
      const value = decodeSegment(v);
      if (value === null) return null;
      params[p.slice(1)] = value;
    } else if (p !== v) return null;
  }
  return params;
};

export const createApp = (deps: Deps): App => ({
  fetch: async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    for (const route of ROUTE_DEFINITIONS) {
      if (route.method !== req.method) continue;
      const params = matchPath(route.path, url.pathname);
      if (!params) continue;
      return route.handle(req, deps, params);
    }
    // どの入口にも当たらない（経路が無い・壊れた区間）。入口の「番号が無い」と同じ 404・not_found。
    const missing = notFound();
    return new Response(JSON.stringify(missing.body), { status: missing.status, headers: { "content-type": "application/json" } });
  },
  get routes(): RouteInfo[] {
    return ROUTE_DEFINITIONS.map((r) => ({ method: r.method, path: r.path, auth: r.auth, human: r.human }));
  },
});

/**
 * 橋（lib/entry.ts）が要求を1つ捌く入口。app を組む所（束縛の読み出し・Deps の組み立て）で落ちても、
 * 500・internal の JSON と種類だけの記録で返す（2026-09-25 監査の指摘 設計-15）。
 * 入口の中の例外は defineRoute が先に受け止めるので、ここへ来るのは組み立ての落ちだけ。
 */
export const serveSafely = async (req: Request, build: () => App | Promise<App>, logger: Logger): Promise<Response> => {
  try {
    return await (await build()).fetch(req);
  } catch (error) {
    const result = internalError(logger, "app", error);
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { "content-type": "application/json" } });
  }
};
