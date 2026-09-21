// 画面が fetch を呼ぶただ1つの場所（設計書「ファイル構成の計画」）。応答は zod で形を確かめてから
// 返す（基準 29.4）。断りは例外にせず、型のついた値として呼び出し元へ返す。例外にするのは通信の失敗と
// 応答の形の崩れだけで、どちらも kind: "network" の同じ形へ包む（フォームの側の分岐を1つにするため）。
//
// スキーマをこのファイルの中に書く理由: lib/client が lib/schemas から値として読めるのは
// schemas/limits だけ（設計書「依存の向き」・eslint と構造の検査が見張る）。そこで schemas/error.ts と
// 同じ形を zod だけで最小限に写す。語の一覧（domain/inputRefusal）には踏み込まない——画面は語で
// 分岐せず domain/texts に文を引くだけなので、ここで確かめるのは形だけでよい。
import { z, type ZodType } from "zod";
import type { AppConfig } from "../ports";

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
  current?: { state: string };
  home?: unknown;
};

const fieldRefusalSchema = z.object({ name: z.string(), reason: z.string() });

/** 断りの応答の形。在る項目だけを見る（余分な項目は落とさず、そのまま呼び出し元へ渡す）。 */
const failureSchema = z.object({
  ok: z.literal(false),
  error: z.object({ kind: z.string(), fields: z.array(fieldRefusalSchema).optional() }).optional(),
  refusal: z.object({ kind: z.string(), nextStep: z.string() }).optional(),
  current: z.object({ state: z.string() }).optional(),
});

const networkFailure = (): ApiFailure => ({ ok: false, error: { kind: "network" } });

/** 断り（`ok:false`）かどうか。画面はこれで分けるので、状態コードを持ち歩かない。 */
export const isFailure = (value: unknown): value is ApiFailure => typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === false;

/**
 * 通信そのものが失敗した断り（応答が返らなかった・JSON として読めなかった・形が崩れていた）かどうか。
 * 2026-09-21 タスク14 が足した——確保中の表示は、**通信の失敗のときだけ**端末に残した内容へ倒し、
 * 見分けの断り（401）では登録の入力へ倒す（要件9の基準 9.10・9.11。401 では出さない）。
 * 語で分ける判断を画面に置かないため（断りの語を読むのは `components/ui/InputRefusal` だけ）、
 * 語を知っているこのファイルに判定を置く。
 */
export const isNetworkFailure = (value: unknown): value is ApiFailure => isFailure(value) && value.error?.kind === "network";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * 応答を JSON として受け取り、形を確かめてから返す。断り（`ok:false`）は例外にせず値として返す。
 * `schema` を渡すと成功の応答もその形で検査する（基準 29.4 の成功の側）。渡さなければ形は見ない。
 */
export const apiCall = async <T = Record<string, unknown>>(method: HttpMethod, path: string, body?: unknown, schema?: ZodType<T>): Promise<T | ApiFailure> => {
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
    return failureSchema.safeParse(json).success ? (json as ApiFailure) : networkFailure();
  }
  // ここから先は `ok:false` を持たない応答。アプリ自身の断りは必ず `ok:false` を持つので、
  // 状態コードが 2xx でなければ**アプリの外**が返した既定の応答（プラットフォームの 502・
  // 間に挟まった機器の 503 など）で、成功として読ませてはいけない（2026-09-22 タスク25 が足した）。
  if (!res.ok) return networkFailure();
  if (!schema) return json as T;
  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : networkFailure();
};

// ---------- 少しずつ届く応答（NDJSON） ----------

/** 1行1つの JSON。種類（`type`）で分けるのは呼ぶ側（部品）の仕事。 */
export type StreamLine = Record<string, unknown>;

/** 経路そのものが無かった（古い版のサーバー）。呼ぶ側は普通の入口へ倒す。 */
export const STREAM_UNAVAILABLE = "unavailable";

/** 行が読めたか（`null`）・経路が無いか・断られたか。成功の中身は `onLine` で先に渡してある。 */
export type StreamOutcome = null | typeof STREAM_UNAVAILABLE | ApiFailure;

/** 読めない行は捨てる（1行が壊れても、後ろの行は届く）。 */
const emitLines = (buffer: string, onLine: (line: StreamLine) => void): string => {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    if (part.trim() === "") continue;
    try {
      onLine(JSON.parse(part) as StreamLine);
    } catch {
      // 途中で切れた行・JSON でない行は捨てる
    }
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
 */
export const apiStream = async (path: string, body: unknown, onLine: (line: StreamLine) => void): Promise<StreamOutcome> => {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
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
    return failureSchema.safeParse(json).success ? (json as ApiFailure) : networkFailure();
  }
  const reader = res.body?.getReader();
  // 本文を少しずつ読めない環境（古い browser・検査の偽物）では、普通の入口へ倒す
  if (!reader) return STREAM_UNAVAILABLE;
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer = emitLines(buffer + decoder.decode(chunk.value, { stream: true }), onLine);
    }
  } catch {
    // 途中で切れても、そこまでに届いた行は既に渡してある（画面はそのまま使える）
    return networkFailure();
  }
  emitLines(`${buffer}\n`, onLine);
  return null;
};

/**
 * 公開してよい設定の値（GET /api/config/public）を取る。取れなければ null を返し、
 * 呼ぶ側（フォームの人かどうかの確かめ・プッシュの購読）が「部品を出さない」へ倒す。
 *
 * 形は渡さない——画面が使う3つ（サイトキー・プッシュの公開鍵・連絡先）だけを読み、
 * 欠けていれば読む側が既定へ倒すので、ここで全部を必須にすると却って画面が止まる。
 * **値をメモリに溜めない**: 画面が作り直されるたびに取り直す。公開の直後や設定の入れ替えで
 * 古いサイトキーを掴んだまま断られ続けるのを避ける（この入口は軽く、フォームを開いた時にしか呼ばない）。
 */
export const getPublicConfig = async (): Promise<AppConfig | null> => {
  const result = await apiCall<AppConfig>("GET", "/api/config/public");
  return isFailure(result) ? null : (result as AppConfig);
};
