// 画面が fetch を呼ぶただ1つの場所（設計書「ファイル構成の計画」）。応答は形を確かめてから返す（基準 29.4）。
// 断りは例外にせず、型のついた値として呼び出し元へ返す。例外にするのは通信の失敗と応答の形の崩れだけで、
// どちらも kind: "network" の同じ形へ包む（フォームの側の分岐を1つにするため）。
//
// **成功した応答も必ず形を確かめる**（2026-09-25 監査の指摘 設計-07）。形は schemas/responses の表
// `RESPONSES`（入口の鍵 → 本文の形）が持ち、サーバーの入口（http/respond）も同じ表で本文を組む。
// 画面は `callApi(入口の鍵, …)` で呼び、返る型もその表から決まる——部品ごとに応答の型を手で写さない。
//
// ⚠️ zod は**小さい版（zod/mini）から名前を指定して**読む（設計-09）。`import { z } from "zod"` は
// 約40言語の文言を名前空間ごと抱えていて組み立てで削れず、客の画面の JS の約4割を占めていた。
import { array, literal, object, optional, string, type ZodMiniType } from "zod/mini";
import type { AppConfig } from "../ports";
import { RECEIVE_REFUSAL, RESPONSES, STREAM_LINE, type ParamNames, type PathOf, type ReceiveRefusalDto, type ResponseOf, type RouteKey, type StreamLineDto } from "../schemas/responses";
import { notifySessionExpired } from "./session";

// 画面の部品は lib/schemas を読めない（依存の向き）ので、応答の型はここから名乗る。
export type {
  AdminActionDto,
  AdminMetricsDto,
  AdminReportDto,
  AdminStoreDetailDto,
  AdminStoreRowDto,
  ArrivalDto,
  CustomerHomeDto,
  FetchResultItemDto,
  OfferViewDto,
  ReservationViewDto,
  ResponseOf,
  RouteKey,
  StoreHomeDto,
} from "../schemas/responses";

export type FieldRefusal = { name: string; reason: string };

/**
 * 断りの応答（`ok:false`）。形を確かめてから返すので、在る項目は形が合っている。
 * 中身を持たない断り（未ログインの 401）も在るので、どの項目も `?.` で読む。
 * 応答の3通り（入力の断り `error`・受け取りの断り `refusal` と `home`・状態による断り `current`）を1つの型で受ける。
 */
export type ApiFailure = {
  ok: false;
  error?: { kind: string; fields?: FieldRefusal[]; [extra: string]: unknown };
  refusal?: { kind: string; nextStep: string; [extra: string]: unknown };
  /**
   * `changed` は、運営が見たあとで店の内容が変わった断り（運営の承認と確かめ・運営-02）。
   * `newerReservation` は、期限から20分以内の期限切れでも客が確保し直したので完了済みにできない断り（店-10）
   */
  current?: { state: string; changed?: boolean; newerReservation?: boolean };
  home?: unknown;
};

/**
 * 断りの応答の形。在る項目だけを見る（検査した値ではなく元の値を返すので、余分な項目は落ちない）。
 * 語の一覧（domain/inputRefusal）には踏み込まない——画面は語で分岐せず domain/texts に文を引くだけ。
 */
const failureSchema = object({
  ok: literal(false),
  error: optional(object({ kind: string(), fields: optional(array(object({ name: string(), reason: string() }))) })),
  refusal: optional(object({ kind: string(), nextStep: string() })),
  current: optional(object({ state: string() })),
});

const networkFailure = (): ApiFailure => ({ ok: false, error: { kind: "network" } });

/**
 * 受け取りの断り（409）なら、形（schemas/responses の RECEIVE_REFUSAL）を確かめた本文を返す。ほかの失敗と、形の崩れた
 * 断りは null（2026-09-26 のレビュー・設計-07 の残り）。受け取りの断りは客の画面をまるごと作り直す応答なので、画面は
 * これを通してから `home` を取り込む——崩れた `home` を取り込むと、画面が undefined を描く。
 */
export const receiveRefusalOf = (value: unknown): ReceiveRefusalDto | null => (RECEIVE_REFUSAL.safeParse(value).success ? (value as ReceiveRefusalDto) : null);

export const isFailure = (value: unknown): value is ApiFailure => typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === false;

/**
 * ログインが切れた・していない断り（401・unauthenticated）かどうか（2026-09-25 監査の指摘 横断-01）。
 * ログインの失敗（login_failed）と役割違い（forbidden）は含めない——入り直しても直らない・別の断り。
 * 店と運営の画面は、これを受けたら「ログインが切れました」と /login への道を出す（client/session の知らせ）。
 * 客の画面の入口（GuestEntry）は、ホームがこれを返したときだけ識別子を作り直す（ほかの失敗では作り直さない）。
 */
export const isUnauthenticated = (value: unknown): value is ApiFailure => isFailure(value) && value.error?.kind === "unauthenticated";

/**
 * 取り直せば直るかもしれない失敗（通信の失敗 network・サーバーの不具合 internal）かどうか（設計-15）。
 * 画面は、この失敗では前に取れた内容を残す（登録の入力・空の一覧へ倒さない）。文は語ごとに別
 * （「通信に失敗しました」と「サーバーで問題が起きました」）。
 */
export const isTransientFailure = (value: unknown): value is ApiFailure => isFailure(value) && (value.error?.kind === "network" || value.error?.kind === "internal");

/** 断りを呼び出し元へ返す前に、ログインが切れた断りなら知らせる（聞くのは店と運営の画面の殻だけ）。 */
const passFailure = (failure: ApiFailure): ApiFailure => {
  if (isUnauthenticated(failure)) notifySessionExpired();
  return failure;
};

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * 要求を1つ送り、応答を JSON として受け取り、形を確かめてから返す。断り（`ok:false`）は例外にせず値として返す。
 * 成功の応答は `schema`（応答の形の表の1つ）で必ず確かめる。合わなければ kind: "network"。
 */
const request = async <T>(method: HttpMethod, path: string, body: unknown, schema: ZodMiniType<T>): Promise<T | ApiFailure> => {
  let res: Response;
  try {
    const isForm = typeof FormData !== "undefined" && body instanceof FormData;
    const headers: Record<string, string> = {};
    let payload: BodyInit | undefined;
    if (isForm) payload = body as FormData;
    else if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }
    res = await fetch(path, { method, headers, body: payload });
  } catch {
    return networkFailure();
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    return networkFailure();
  }
  if (isFailure(json)) {
    // 検査した値ではなく元の値を返す（partyMax・home のような場面ごとの項目を落とさないため）。
    return failureSchema.safeParse(json).success ? passFailure(json as ApiFailure) : networkFailure();
  }
  // ここから先は `ok:false` を持たない応答。アプリ自身の断りは必ず `ok:false` を持つので、
  // 状態コードが 2xx でなければ**アプリの外**が返した既定の応答（プラットフォームの 502・
  // 間に挟まった機器の 503 など）で、成功として読ませてはいけない（2026-09-22 タスク25 が足した）。
  if (!res.ok) return networkFailure();
  // 成功の形を確かめる。検査した値ではなく元の値を返す（形の表に書いていない項目も落とさない）。
  return schema.safeParse(json).success ? (json as T) : networkFailure();
};

/** 入口の鍵（`"GET /api/store/home"`）を method と path の形へ分ける。 */
const splitRoute = (route: RouteKey): { method: HttpMethod; pattern: string } => {
  const space = route.indexOf(" ");
  return { method: route.slice(0, space) as HttpMethod, pattern: route.slice(space + 1) };
};

/** 形の表の鍵の中から、method と path（問い合わせ文字列を除く）が当たるものを探す。無ければ null。 */
const findRoute = (method: HttpMethod, path: string): RouteKey | null => {
  const actual = path.split("?", 1)[0].split("/").filter(Boolean);
  const matches = (pattern: string): boolean => {
    const parts = pattern.split("/").filter(Boolean);
    return parts.length === actual.length && parts.every((part, i) => part.startsWith(":") || part === actual[i]);
  };
  const keys = Object.keys(RESPONSES) as RouteKey[];
  return keys.find((key) => splitRoute(key).method === method && matches(splitRoute(key).pattern)) ?? null;
};

/**
 * method と path で呼ぶ（低い層の道・画面の部品は `callApi` を使う）。path に当たる入口の形で、成功の応答を
 * 必ず確かめる。形の表に載っていない入口は、確かめられないので kind: "network" に倒す（黙って通さない）。
 */
export const apiCall = async (method: HttpMethod, path: string, body?: unknown): Promise<unknown> => {
  const route = findRoute(method, path);
  if (route === null) return networkFailure();
  return request(method, path, body, RESPONSES[route] as ZodMiniType<unknown>);
};

type QueryValue = string | number | null | undefined;

/** `callApi` に渡すもの。動的な区間を持つ入口は `params` が要る（型が求める）。 */
export type CallOptions<K extends RouteKey> = { body?: unknown; query?: Record<string, QueryValue> } & ([ParamNames<PathOf<K>>] extends [never]
  ? { params?: undefined }
  : { params: Record<ParamNames<PathOf<K>>, string> });

type CallArgs<K extends RouteKey> = [ParamNames<PathOf<K>>] extends [never] ? [options?: CallOptions<K>] : [options: CallOptions<K>];

/** 鍵の `:名前` を値で埋め（区間ごとに percent 符号にする）、問い合わせ文字列を足す（空の値は送らない）。 */
const buildPath = (pattern: string, params: Record<string, string> = {}, query: Record<string, QueryValue> = {}): string => {
  const path = pattern.replace(/:(\w+)/g, (_, name: string) => encodeURIComponent(params[name] ?? ""));
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `${path}?${text}` : path;
};

/**
 * 画面が入口を呼ぶ道（2026-09-25 監査の指摘 設計-07）。`route` は入口の鍵（`"POST /api/store/coupons"`）で、
 * 成功の応答は必ずその入口の形（schemas/responses）で確かめてから返す。返る型も同じ表から決まるので、
 * サーバーの本文の項目を変えると、画面の側も型検査で落ちる。
 */
export const callApi = async <K extends RouteKey>(route: K, ...[options]: CallArgs<K>): Promise<ResponseOf<K> | ApiFailure> => {
  const { method, pattern } = splitRoute(route);
  const opts = (options ?? {}) as { body?: unknown; query?: Record<string, QueryValue>; params?: Record<string, string> };
  return request(method, buildPath(pattern, opts.params, opts.query), opts.body, RESPONSES[route] as unknown as ZodMiniType<ResponseOf<K>>);
};

// ---------- 少しずつ届く応答（NDJSON） ----------

/**
 * 1行1つの JSON。形は schemas/responses の STREAM_LINE（サーバーの usecases/streamOffers と同じ定義）で、
 * 形に合わない行は捨てる（設計-07）。種類（`type`）で分けるのは呼ぶ側（部品）の仕事。
 */
export type StreamLine = StreamLineDto;

/** 経路そのものが無かった（古い版のサーバー）。呼ぶ側は普通の入口へ倒す。 */
export const STREAM_UNAVAILABLE = "unavailable";

/** 行が読めたか（`null`）・経路が無いか・断られたか。成功の中身は `onLine` で先に渡してある。 */
export type StreamOutcome = null | typeof STREAM_UNAVAILABLE | ApiFailure;

/** 1行を読む。JSON でない・形に合わない行は null（捨てる）。 */
const parseLine = (part: string): StreamLine | null => {
  try {
    const value: unknown = JSON.parse(part);
    return STREAM_LINE.safeParse(value).success ? (value as StreamLine) : null;
  } catch {
    return null;
  }
};

/** 読めない行は捨てる（1行が壊れても、後ろの行は届く）。 */
const emitLines = (buffer: string, onLine: (line: StreamLine) => void): string => {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    if (part.trim() === "") continue;
    // 途中で切れた行・JSON でない行・形に合わない行は捨てる
    const line = parseLine(part);
    if (line !== null) onLine(line);
  }
  return rest;
};

/**
 * 少しずつ届く応答（NDJSON）を1行ずつ読む（入口 `POST /api/customer/fetch/stream`）。
 *
 * **画面の側の値打ちは「待たせない」こと**——店のカードは最初の行で出せるので、人格つきの
 * 紹介文（1本ずつ AI を2往復する）を待たずに客が選び始められる。
 *
 * 断り（`ok:false`）は普通の入口と同じ形で返し、経路が無ければ `STREAM_UNAVAILABLE` を返す
 * （呼ぶ側が普通の入口へ倒せるように——**少しずつ届くのは速さの工夫で、機能の前提ではない**）。
 *
 * `signal` が止められたら、それ以降の行は `onLine` へ渡さず読み取りを打ち切る（2026-09-25 監査の指摘 不具合-06。
 * 探し直した・受け取った・画面を離れたあとに、前の検索の紹介文が一覧を上書きしていた）。合図は fetch にも渡すが、
 * 合図を聞かない相手（途中の機器・検査の偽物）でも止まるよう、1行ごとに読み取りの側でも確かめる。
 */
export const apiStream = async (path: string, body: unknown, onLine: (line: StreamLine) => void, signal?: AbortSignal): Promise<StreamOutcome> => {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  } catch {
    return networkFailure();
  }
  // 経路が無い（404）・方法が違う（405）＝この入口を持たないサーバー
  if (res.status === 404 || res.status === 405) return STREAM_UNAVAILABLE;
  if (!res.ok) {
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return networkFailure();
    }
    if (!isFailure(json)) return networkFailure();
    return failureSchema.safeParse(json).success ? passFailure(json as ApiFailure) : networkFailure();
  }
  const reader = res.body?.getReader();
  // 本文を少しずつ読めない環境（古い browser・検査の偽物）では、普通の入口へ倒す
  if (!reader) return STREAM_UNAVAILABLE;
  const decoder = new TextDecoder();
  let buffer = "";
  // 止められたあとは1行も渡さない（`emitLines` が1行ごとにここを通す）
  const deliver = (line: StreamLine) => {
    if (signal?.aborted !== true) onLine(line);
  };
  try {
    for (;;) {
      if (signal?.aborted === true) {
        await reader.cancel().catch(() => undefined);
        return networkFailure();
      }
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer = emitLines(buffer + decoder.decode(chunk.value, { stream: true }), deliver);
    }
  } catch {
    // 途中で切れても、そこまでに届いた行は既に渡してある（画面はそのまま使える）
    return networkFailure();
  }
  emitLines(`${buffer}\n`, deliver);
  return null;
};

/**
 * 公開してよい設定の値（GET /api/config/public）を取る。取れなければ null を返し、
 * 呼ぶ側（フォームの人かどうかの確かめ・プッシュの購読）が「部品を出さない」へ倒す。
 *
 * 形の表（schemas/responses）でも3つとも任意にしてある——画面が使う3つ（サイトキー・プッシュの公開鍵・
 * 連絡先）は、欠けていれば読む側が既定へ倒すので、全部を必須にすると却って画面が止まる。
 * **値をメモリに溜めない**: 画面が作り直されるたびに取り直す。公開の直後や設定の入れ替えで
 * 古いサイトキーを掴んだまま断られ続けるのを避ける（この入口は軽く、フォームを開いた時にしか呼ばない）。
 */
export const getPublicConfig = async (): Promise<Partial<AppConfig> | null> => {
  const result = await callApi("GET /api/config/public");
  return isFailure(result) ? null : { turnstileSiteKey: result.turnstileSiteKey, vapidPublicKey: result.vapidPublicKey, contactEmail: result.contactEmail ?? null };
};
