// 入力の検査・見分け・Origin・人かどうかの確かめ・zod の落ちを「入力の断り」の応答の形へ直す、
// ただ1つの場所（設計書「ファイル構成の計画」）。app/api/**/route.ts はここが組んだ手続きを
// 実物の Deps で呼ぶだけで、要求の本文を自分で読まない（構造の検査が見張る）。

import type { ZodType } from "zod";
import type { FieldReason } from "../domain/inputRefusal";
import type { Deps } from "../ports";
import { checkOrigin, identifyCustomer, identifySession, renewSession } from "./guards";
import { admitRequest, rateRulesFor, settleCharges } from "./rateLimits";
import { forbidden, refusal, unauthenticated } from "./refusals";
import { internalError } from "./unhandled";

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

export type RouteHandlerResult = {
  status: number;
  body: unknown;
  cookies?: string[];
  /**
   * JSON でない本文を返す入口だけが使う（営業許可書のファイル・要件13の基準 13.5）。
   * ここが在れば `body` は見ず、この本文と見出しをそのまま返す（2026-09-21・タスク7 が足した）。
   */
  raw?: { body: BodyInit; headers: Record<string, string> };
};

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

/** JSON でない本文（ファイル）を返す。見出しは手続きが全部決める。 */
const rawResponse = (status: number, raw: NonNullable<RouteHandlerResult["raw"]>, cookies: string[] = []): Response => {
  const headers = new Headers(raw.headers);
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(raw.body, { status, headers });
};

const invalidInput = (fields: Array<{ name: string; reason: FieldReason }>): RouteHandlerResult => refusal("invalid_input", { fields });

/** 組み立てた結果を応答へ（JSON かファイルか）。見分けのあとに延ばしたセッションの Set-Cookie も足す。 */
const toResponse = (result: RouteHandlerResult, extraCookies: string[] = []): Response => {
  const cookies = [...(result.cookies ?? []), ...extraCookies];
  return result.raw ? rawResponse(result.status, result.raw, cookies) : jsonResponse(result.status, result.body, cookies);
};

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

/** 見分けの結果。断るときは応答、通すときは文脈と、延ばしたセッションの Set-Cookie。 */
type Identified = { ok: true; ctx: RouteAuthContext; renewCookies: string[] } | { ok: false; result: RouteHandlerResult };

/** 見分け（客の Cookie・店と運営のセッション）。401 は unauthenticated、役割違いは 403 の forbidden。 */
const identify = async (auth: RouteAuth, req: Request, deps: Deps): Promise<Identified> => {
  if (auth === "public") return { ok: true, ctx: { auth: "public" }, renewCookies: [] };
  if (auth === "customer") {
    const customerId = await identifyCustomer(req, deps);
    return customerId ? { ok: true, ctx: { auth: "customer", customerId }, renewCookies: [] } : { ok: false, result: unauthenticated() };
  }
  const session = await identifySession(req, deps);
  if (!session) return { ok: false, result: unauthenticated() };
  if (session.role !== auth) return { ok: false, result: forbidden() };
  // 役割が店なのに店の番号が無いアカウントは断る（本人選択 2026-09-21）。
  // 空の文字列へ黙って倒すと、どの店にも当たらない問い合わせが「正しく通った」ように見える。
  if (auth === "store" && !session.storeId) return { ok: false, result: forbidden() };
  const ctx: RouteAuthContext =
    auth === "store"
      ? { auth: "store", accountId: session.accountId, storeId: session.storeId as string, mustChangePassword: session.mustChangePassword }
      : { auth: "admin", accountId: session.accountId };
  // 使われたセッションを延ばしたときの Set-Cookie（延ばさなければ空）。応答に足して返す。
  return { ok: true, ctx, renewCookies: await renewSession(deps, session) };
};

/** 本文を読んでスキーマで確かめる。落ちたら入力の断り（400）。 */
const readInput = async <TInput>(schema: ZodType<TInput> | undefined, req: Request): Promise<{ ok: true; raw: unknown; input: TInput } | { ok: false; result: RouteHandlerResult }> => {
  const raw = await parseBody(req);
  if (raw === UNREADABLE_BODY) return { ok: false, result: invalidInput([{ name: "body", reason: "bad_format" }]) };
  if (!schema) return { ok: true, raw, input: raw as TInput };
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, raw, input: parsed.data };
  const fields = parsed.error.issues.map((issue) => ({ name: String(issue.path[0] ?? ""), reason: reasonFromIssue(issue as never) }));
  return { ok: false, result: invalidInput(fields) };
};

/** 人かどうかの確かめ。値が無ければ外のサービスに聞かずに断る。 */
const passHumanCheck = async (deps: Deps, raw: unknown, deadline: Promise<void>): Promise<boolean> => {
  const rawToken = (raw as Record<string, unknown> | null)?.humanToken;
  const token = typeof rawToken === "string" && rawToken !== "" ? rawToken : null;
  // 値が無ければ、外のサービスに聞かずに断る（設計書「人かどうかの確かめ」: 確かめが取れないときも
  // 断る・本人選択。守りが、部品の読み込みや外の調子で黙って外れないようにするため）。
  return token !== null && (await verifyHuman(deps, token, deadline));
};

/**
 * 手続きを呼ぶ。**想定外の例外はここで受け止め**、500・internal の JSON と種類だけの記録にする
 * （監査の指摘 設計-15）——受け止めないと Next の既定の 500（JSON でない本文）が返り、画面は
 * 「通信に失敗した」と取り違え、ログインの失敗の数え上げも飛ぶ。
 */
const runHandler = async <TInput, TAuth extends RouteAuth>(config: RouteConfig<TInput, TAuth>, args: RouteHandlerArgs<TInput, TAuth>): Promise<RouteHandlerResult> => {
  try {
    return await config.handler(args);
  } catch (error) {
    return internalError(args.deps.logger, routeId(config), error);
  }
};

const routeId = (config: { method: HttpMethod; path: string }): string => `${config.method} ${config.path}`;

const handleRoute = async <TInput, TAuth extends RouteAuth>(config: RouteConfig<TInput, TAuth>, req: Request, deps: Deps, params: Record<string, string>): Promise<Response> => {
  // 人かどうかの確かめの3秒は、本文を読む前から数え始める（最初の await より前に合図を作る・下の注）。
  const humanDeadline = config.human ? deps.clock.after(HUMAN_CHECK_TIMEOUT_MS) : null;

  if (req.method !== "GET" && !checkOrigin(req)) return toResponse(forbidden());

  const identified = await identify(config.auth, req, deps);
  if (!identified.ok) return toResponse(identified.result);
  const { ctx, renewCookies } = identified;

  const read = await readInput(config.input, req);
  if (!read.ok) return toResponse(read.result, renewCookies);
  const { raw, input } = read;

  if (humanDeadline && !(await passHumanCheck(deps, raw, humanDeadline))) return toResponse(refusal("human_check_failed"));

  // 【最終日】連打の抑止（要件30）。見分け・入力の検査・人かどうかの確かめが済んだ時点で数え、手続きより
  // 手前で断る——断った取得では AI も地図も呼ばれない（基準 30.5）。どの入口を数えるかは rateLimits.ts の表。
  // 人かどうかの確かめより後で数えるのは、確かめに落ちた空振りで回数を減らさないため（不具合-04）——
  // 先に数えると、同じ回線にいる人が確かめを解かずに送るだけで、その回線の全員の登録やログインを止められた。
  const rateRules = rateRulesFor(config.method, config.path);
  const admission =
    rateRules.length === 0
      ? null
      : await admitRequest(deps, rateRules, {
          ip: req.headers.get("cf-connecting-ip"),
          customerId: ctx.auth === "customer" ? ctx.customerId : null,
          accountId: ctx.auth === "store" || ctx.auth === "admin" ? ctx.accountId : null,
          input,
        });
  if (admission?.refused) return toResponse(refusal("rate_limited"), renewCookies);

  const result = await runHandler(config, { input, params, req, deps, ctx: ctx as RouteAuthContextFor<TAuth> });
  // 落ちた要求だけを数える規則（ログインの失敗・基準 30.4 など）は、先に数えた1回ぶんを、通ったときだけ取り消す。
  // 例外で終わった要求（500）も「落ちた」として数えたまま（受け止めたので、ここまで必ず来る）。
  if (admission) await settleCharges(deps, admission.charges, result.status < 400);
  return toResponse(result, renewCookies);
};

export const defineRoute = <TInput, TAuth extends RouteAuth>(config: RouteConfig<TInput, TAuth>): RouteDefinition => ({
  method: config.method,
  path: config.path,
  auth: config.auth,
  human: config.human ?? false,
  handle: async (req, deps, params = {}) => {
    // 見分け・連打の抑止・記録の読み書きで起きた想定外の例外も、ここで受け止める（設計-15）。
    try {
      return await handleRoute(config, req, deps, params);
    } catch (error) {
      return toResponse(internalError(deps?.logger, routeId(config), error));
    }
  },
});
