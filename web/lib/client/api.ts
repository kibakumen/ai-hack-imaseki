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

const isRefused = (value: unknown): boolean => typeof value === "object" && value !== null && (value as { ok?: unknown }).ok === false;

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
  if (isRefused(json)) {
    // 検査した値ではなく元の値を返す（partyMax・home のような場面ごとの項目を落とさないため）。
    return failureSchema.safeParse(json).success ? (json as ApiFailure) : networkFailure();
  }
  if (!schema) return json as T;
  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : networkFailure();
};

let cachedConfig: AppConfig | null = null;

/**
 * 公開してよい設定の値（GET /api/config/public）を1回取ってメモリに持つ（取り直さない）。
 * 形は渡さない——画面が使う3つ（サイトキー・プッシュの公開鍵・連絡先）だけを読み、
 * 欠けていれば読む側が既定へ倒すので、ここで全部を必須にすると却って画面が止まる。
 */
export const getPublicConfig = async (): Promise<AppConfig | null> => {
  if (cachedConfig) return cachedConfig;
  const result = await apiCall<AppConfig>("GET", "/api/config/public");
  if ((result as ApiFailure).ok === false) return null;
  cachedConfig = result as AppConfig;
  return cachedConfig;
};
