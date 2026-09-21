// 入力の検査・見分け・Origin・人かどうかの確かめ・zod の落ちを「入力の断り」の応答の形へ直す、
// ただ1つの場所（設計書「ファイル構成の計画」）。app/api/**/route.ts はここが組んだ手続きを
// 実物の Deps で呼ぶだけで、要求の本文を自分で読まない（構造の検査が見張る）。

import type { ZodType } from "zod";
import type { InputRefusalKind, FieldReason } from "../domain/inputRefusal";
import type { Deps } from "../ports";
import { checkOrigin, identifyCustomer, identifySession } from "./guards";

export type RouteAuth = "public" | "customer" | "store" | "admin";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RouteAuthContext =
  | { auth: "public" }
  | { auth: "customer"; customerId: string }
  | { auth: "store"; accountId: string; storeId: string }
  | { auth: "admin"; accountId: string };

export type RouteHandlerResult = { status: number; body: unknown; cookies?: string[] };

export type RouteHandlerArgs<TInput> = {
  input: TInput;
  params: Record<string, string>;
  req: Request;
  deps: Deps;
  ctx: RouteAuthContext;
};

export type RouteConfig<TInput> = {
  method: HttpMethod;
  path: string;
  auth: RouteAuth;
  /** 人かどうかの確かめ（Turnstile）つきの入口か。登録・ログインの入口だけ true にする。 */
  human?: boolean;
  /** 入力のスキーマ。無ければ検査はしない（GET で入力を持たない入口など）。 */
  input?: ZodType<TInput>;
  handler: (args: RouteHandlerArgs<TInput>) => Promise<RouteHandlerResult>;
};

export type RouteDefinition = {
  method: HttpMethod;
  path: string;
  auth: RouteAuth;
  human: boolean;
  handle: (req: Request, deps: Deps, params?: Record<string, string>) => Promise<Response>;
};

const jsonResponse = (status: number, body: unknown, cookies: string[] = []): Response => {
  const headers = new Headers({ "content-type": "application/json" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(JSON.stringify(body), { status, headers });
};

const invalidInput = (fields: Array<{ name: string; reason: FieldReason }>): RouteHandlerResult => ({
  status: 400,
  body: { ok: false, error: { kind: "invalid_input" as InputRefusalKind, fields } },
});

/** zod（v4）の落ちの1つを、閉じた語 FieldReason へ直す（設計書「入力の断りの応答の形」）。 */
const reasonFromIssue = (issue: { code: string; origin?: string; expected?: string; format?: string; message: string }): FieldReason => {
  switch (issue.code) {
    case "too_small":
      return issue.origin === "string" || issue.origin === "array" ? "too_short" : "out_of_range";
    case "too_big":
      return issue.origin === "string" || issue.origin === "array" ? "too_long" : "out_of_range";
    case "invalid_type":
      if (/received undefined/.test(issue.message)) return "required";
      return issue.expected === "int" || issue.format === "safeint" ? "not_integer" : "required";
    case "invalid_format":
    case "invalid_string":
      return "bad_format";
    case "invalid_value":
    case "invalid_enum_value":
      return "not_allowed";
    default:
      return "bad_format";
  }
};

/** 本文がそもそも読めなかった印（multipart が壊れている・本文が途中で切れた）。入力の断り 400 へ倒す。 */
const UNREADABLE_BODY = Symbol("unreadable-body");

const parseBody = async (req: Request): Promise<unknown> => {
  if (req.method === "GET" || req.method === "DELETE") {
    return Object.fromEntries(new URL(req.url).searchParams.entries());
  }
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    try {
      return Object.fromEntries((await req.formData()).entries());
    } catch {
      return UNREADABLE_BODY;
    }
  }
  let text: string;
  try {
    text = await req.text();
  } catch {
    return UNREADABLE_BODY;
  }
  if (!text) return {};
  try {
    // JSON になっていない本文は「項目が何も無い」として扱い、スキーマの検査に判定を任せる。
    return JSON.parse(text);
  } catch {
    return {};
  }
};

/** 打ち切り3秒（設計書「入口の一覧」の注）。fake の時計が after を進める。 */
const HUMAN_CHECK_TIMEOUT_MS = 3000;

const verifyHuman = async (deps: Deps, token: string | null): Promise<boolean> => {
  const controller = new AbortController();
  void deps.clock.after(HUMAN_CHECK_TIMEOUT_MS).then(() => controller.abort());
  try {
    const result = await deps.human.verify(token, { signal: controller.signal });
    return result.ok && result.human;
  } catch {
    return false;
  }
};

export const defineRoute = <TInput>(config: RouteConfig<TInput>): RouteDefinition => ({
  method: config.method,
  path: config.path,
  auth: config.auth,
  human: config.human ?? false,
  handle: async (req, deps, params = {}) => {
    if (req.method !== "GET" && !checkOrigin(req)) {
      return jsonResponse(403, { ok: false, error: { kind: "invalid_input" as InputRefusalKind } });
    }

    let ctx: RouteAuthContext;
    if (config.auth === "public") {
      ctx = { auth: "public" };
    } else if (config.auth === "customer") {
      const customerId = await identifyCustomer(req, deps);
      if (!customerId) return jsonResponse(401, { ok: false, error: { kind: "invalid_input" as InputRefusalKind } });
      ctx = { auth: "customer", customerId };
    } else {
      const session = await identifySession(req, deps);
      if (!session) return jsonResponse(401, { ok: false, error: { kind: "invalid_input" as InputRefusalKind } });
      if (session.role !== config.auth) return jsonResponse(403, { ok: false, error: { kind: "invalid_input" as InputRefusalKind } });
      ctx = config.auth === "store" ? { auth: "store", accountId: session.accountId, storeId: session.storeId ?? "" } : { auth: "admin", accountId: session.accountId };
    }

    const raw = await parseBody(req);
    if (raw === UNREADABLE_BODY) {
      const result = invalidInput([{ name: "body", reason: "bad_format" }]);
      return jsonResponse(result.status, result.body);
    }

    let input = raw as TInput;
    if (config.input) {
      const parsed = config.input.safeParse(raw);
      if (!parsed.success) {
        const fields = parsed.error.issues.map((issue) => ({ name: String(issue.path[0] ?? ""), reason: reasonFromIssue(issue as never) }));
        const result = invalidInput(fields);
        return jsonResponse(result.status, result.body);
      }
      input = parsed.data;
    }

    if (config.human) {
      const token = typeof (raw as Record<string, unknown>)?.humanToken === "string" ? ((raw as Record<string, unknown>).humanToken as string) : null;
      const human = await verifyHuman(deps, token);
      if (!human) return jsonResponse(400, { ok: false, error: { kind: "human_check_failed" as InputRefusalKind } });
    }

    const result = await config.handler({ input, params, req, deps, ctx });
    return jsonResponse(result.status, result.body, result.cookies);
  },
});
