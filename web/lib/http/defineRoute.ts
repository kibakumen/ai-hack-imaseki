// 入力の検査・見分け・Origin・人かどうかの確かめ・zod の落ちを「入力の断り」の応答の形へ直す、
// ただ1つの場所（設計書「ファイル構成の計画」）。app/api/**/route.ts はここが組んだ手続きを
// 実物の Deps で呼ぶだけで、要求の本文を自分で読まない（構造の検査が見張る）。

import type { ZodType } from "zod";
import type { InputRefusalKind, FieldReason } from "../domain/inputRefusal";
import type { Deps } from "../ports";
import { checkOrigin, identifyCustomer, identifySession, renewSession } from "./guards";

export type RouteAuth = "public" | "customer" | "store" | "admin";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RouteAuthContext =
  | { auth: "public" }
  | { auth: "customer"; customerId: string }
  /** `mustChangePassword` は【最終日】仮のパスワードで入った店の印（要件14の基準 14.14） */
  | { auth: "store"; accountId: string; storeId: string; mustChangePassword: boolean }
  | { auth: "admin"; accountId: string };

/** 見分けが済んだあとの文脈。`auth: "customer"` の入口の手続きは customerId だけを受け取る。 */
export type RouteAuthContextFor<TAuth extends RouteAuth> = Extract<RouteAuthContext, { auth: TAuth }>;

export type RouteHandlerResult = { status: number; body: unknown; cookies?: string[] };

export type RouteHandlerArgs<TInput, TAuth extends RouteAuth> = {
  input: TInput;
  params: Record<string, string>;
  req: Request;
  deps: Deps;
  ctx: RouteAuthContextFor<TAuth>;
};

export type RouteConfig<TInput, TAuth extends RouteAuth> = {
  method: HttpMethod;
  path: string;
  auth: TAuth;
  /** 人かどうかの確かめ（Turnstile）つきの入口か。登録・ログインの入口だけ true にする。 */
  human?: boolean;
  /** 入力のスキーマ。無ければ検査はしない（GET で入力を持たない入口など）。 */
  input?: ZodType<TInput>;
  handler: (args: RouteHandlerArgs<TInput, TAuth>) => Promise<RouteHandlerResult>;
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

/** 打ち切り3秒（設計書「入口の一覧」の注）。差し替えた時計が after を進める。 */
const HUMAN_CHECK_TIMEOUT_MS = 3000;

const TIMED_OUT: unique symbol = Symbol("human-check-timed-out");

/**
 * 人かどうかの確かめを、打ち切りの合図と競争させる（設計書「時間の割り振り」: 時計と AbortSignal の両方で書く）。
 * 答えが返らない・確かめられない・人でない、のどれでも false（断るのは呼ぶ側）。
 *
 * ⚠️ `deadline` は**この関数の外で、要求を読み始める前に**作る。差し替えた時計は「今」を進めた
 * その時に待っている合図だけを起こすので、進めたあとに作った合図はもう起きない。
 */
const verifyHuman = async (deps: Deps, token: string, deadline: Promise<void>): Promise<boolean> => {
  const controller = new AbortController();
  const verifying = (async () => {
    try {
      return await deps.human.verify(token, { signal: controller.signal });
    } catch {
      return { ok: false as const };
    }
  })();
  const result = await Promise.race([verifying, deadline.then((): typeof TIMED_OUT => TIMED_OUT)]);
  if (result === TIMED_OUT) {
    // 外への呼び出しを解く（実物の fetch はここで止まる）。
    controller.abort();
    return false;
  }
  return result.ok && result.human;
};

export const defineRoute = <TInput, TAuth extends RouteAuth>(config: RouteConfig<TInput, TAuth>): RouteDefinition => ({
  method: config.method,
  path: config.path,
  auth: config.auth,
  human: config.human ?? false,
  handle: async (req, deps, params = {}) => {
    // 人かどうかの確かめの3秒は、本文を読む前から数え始める（最初の await より前に合図を作る・下の注）。
    const humanDeadline = config.human ? deps.clock.after(HUMAN_CHECK_TIMEOUT_MS) : null;

    if (req.method !== "GET" && !checkOrigin(req)) {
      return jsonResponse(403, { ok: false, error: { kind: "invalid_input" as InputRefusalKind } });
    }

    let ctx: RouteAuthContext;
    // 使われたセッションを延ばしたときの Set-Cookie（延ばさなければ空）。応答に足して返す。
    let renewCookies: string[] = [];
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
      if (config.auth === "store") {
        // 役割が店なのに店の番号が無いアカウントは断る（本人選択 2026-09-21）。
        // 空の文字列へ黙って倒すと、どの店にも当たらない問い合わせが「正しく通った」ように見える。
        if (!session.storeId) return jsonResponse(403, { ok: false, error: { kind: "invalid_input" as InputRefusalKind } });
        ctx = { auth: "store", accountId: session.accountId, storeId: session.storeId, mustChangePassword: session.mustChangePassword };
      } else {
        ctx = { auth: "admin", accountId: session.accountId };
      }
      renewCookies = await renewSession(deps, session);
    }

    const raw = await parseBody(req);
    if (raw === UNREADABLE_BODY) {
      const result = invalidInput([{ name: "body", reason: "bad_format" }]);
      return jsonResponse(result.status, result.body, renewCookies);
    }

    let input = raw as TInput;
    if (config.input) {
      const parsed = config.input.safeParse(raw);
      if (!parsed.success) {
        const fields = parsed.error.issues.map((issue) => ({ name: String(issue.path[0] ?? ""), reason: reasonFromIssue(issue as never) }));
        const result = invalidInput(fields);
        return jsonResponse(result.status, result.body, renewCookies);
      }
      input = parsed.data;
    }

    if (config.human && humanDeadline) {
      const rawToken = (raw as Record<string, unknown>)?.humanToken;
      const token = typeof rawToken === "string" && rawToken !== "" ? rawToken : null;
      // 値が無ければ、外のサービスに聞かずに断る（設計書「人かどうかの確かめ」: 確かめが取れないときも
      // 断る・本人選択。守りが、部品の読み込みや外の調子で黙って外れないようにするため）。
      const human = token !== null && (await verifyHuman(deps, token, humanDeadline));
      if (!human) return jsonResponse(400, { ok: false, error: { kind: "human_check_failed" as InputRefusalKind } });
    }

    const result = await config.handler({ input, params, req, deps, ctx: ctx as RouteAuthContextFor<TAuth> });
    return jsonResponse(result.status, result.body, [...(result.cookies ?? []), ...renewCookies]);
  },
});
