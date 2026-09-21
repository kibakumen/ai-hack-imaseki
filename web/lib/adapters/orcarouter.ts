// AI の呼び出しの実物（差し替え口 AiSelector の OrcaRouter 版）。**AI を呼ぶ URL が在るのはここだけ**
// （基準 34.3・34.4・構造の検査が見張る）。呼び方は速成版 `sprint/lib/llm.ts` の実績のある形を写した。
//
// AI は道具（tool）を1つも持たない（設計書「AI まわりの守り」の1段目）。だから要求の本文に道具の
// 一覧も選び方も入れない。出力として通るのは domain/selection の検査を通ったものだけで、並び順すら
// AI から取らない（基準 4.12）。
//
// 打ち切り（基準 7.6 の6秒）は呼ぶ側（usecases/fetchOffers）が AbortSignal で渡す——この口は
// 時間を数えない（時計を知らないため・依存の向き）。

import type { AiSelectInput, AiSelectResult, AiSelector } from "../ports";

/** AI を呼ぶ URL（基準 34.3・34.4: 在るのはこのファイルだけ。検査はここを読んで突き合わせる）。 */
export const ORCAROUTER_ENDPOINT = "https://api.orcarouter.ai/v1/chat/completions";

/**
 * 受け皿（設計書「OrcaRouter の使い方」②）。候補に入れていない**別ベンダー**の1本で、
 * 上流の 5xx・429・通信断のときだけ OrcaRouter の側が切り替える。
 * ⚠️ 綴りはカタログの実物（ドット。`claude-haiku-4-5` ではない）。
 */
export const FALLBACK_MODEL = "anthropic/claude-haiku-4.5";

export type OrcaRouterConfig = {
  apiKey: string;
  /** 呼ぶモデル。提出版は Named Router `orcarouter/ai-sekitori`（設定 ORCAROUTER_MODEL・adapters/env.ts） */
  model: string;
  /** 差し替えるための口（検査が偽物を渡す）。既定は実物 */
  fetch?: typeof fetch;
};

type ChatResponse = {
  choices?: Array<{ message?: { content?: unknown } }>;
  usage?: { cost_usd?: unknown };
  error?: { code?: unknown };
};

const SYSTEM_PROMPT = [
  "あなたは飲食店のおすすめ係です。客の条件と店の情報を見比べて、合う店を最大5件選びます。",
  "選べるのは渡した一覧の id だけ。同じ店を2回選ばない。合う店が無ければ空の配列を返す。",
  "理由は日本語1文・60字以内・改行なし。その客の好みと、その店のジャンルかおすすめメニューに触れる。",
  'JSON だけを返す: {"selections":[{"storeId":"","reason":""}]}',
].join("\n");

/** 渡すのは店の姿と、その回の客の条件だけ（呼び名も電話番号も型に無い・基準 28.3）。 */
const userPrompt = (input: AiSelectInput): string =>
  [
    `客: ${input.party}人。好みのジャンル: ${input.genres.join("・") || "こだわらない"}。1人あたりの予算の上限: ${input.budgetMax === null ? "指定なし" : `${input.budgetMax}円`}`,
    "店の一覧:",
    ...input.stores.map((store) => `- id=${store.id} ジャンル=${store.genres.join("・")} おすすめメニュー=${store.menus.join("・")} 1人${store.budgetMin}〜${store.budgetMax}円`),
  ].join("\n");

const numberOrNull = (raw: string | null): number | null => {
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

const errorCodeOf = async (res: Response): Promise<string> => {
  try {
    const body = (await res.json()) as ChatResponse;
    return typeof body.error?.code === "string" ? body.error.code : `http_${res.status}`;
  } catch {
    return `http_${res.status}`;
  }
};

export const createOrcaRouterSelector = (config: OrcaRouterConfig): AiSelector => {
  const send = config.fetch ?? fetch;
  return {
    select: async (input, opts): Promise<AiSelectResult> => {
      try {
        const res = await send(ORCAROUTER_ENDPOINT, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${config.apiKey}`,
            "X-OrcaRouter-Include-Cost": "true",
          },
          body: JSON.stringify({
            model: config.model,
            // 受け皿（順に試す配列＋切り替えの指定）。発火するのは上流の 5xx・429・通信断だけ。
            models: [config.model, FALLBACK_MODEL],
            route: "fallback",
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: userPrompt(input) },
            ],
            temperature: 0.2,
          }),
          signal: opts.signal,
        });
        // Guardrails に弾かれた 400 も、上流の 5xx も、同じ「失敗」の道（呼ぶ側が点数順に倒す）。
        if (!res.ok) return { ok: false, error: await errorCodeOf(res), costUsd: null };
        const body = (await res.json()) as ChatResponse;
        const text = body.choices?.[0]?.message?.content;
        const costUsd = typeof body.usage?.cost_usd === "number" ? body.usage.cost_usd : null;
        if (typeof text !== "string" || text === "") return { ok: false, error: "empty_content", costUsd };
        return {
          ok: true,
          text,
          costUsd,
          // 応答ヘッダーの3列（無ければ NULL のまま——0 や空文字に補わない）
          resolvedModel: res.headers.get("X-Orca-Resolved-Model"),
          requestId: res.headers.get("X-Orca-Request-Id"),
          fallbackLevel: numberOrNull(res.headers.get("X-Orca-Fallback-Level")),
        };
      } catch {
        // 打ち切り（AbortSignal）も通信の失敗も、例外を外へ出さずに「失敗」として返す。
        return { ok: false, error: "network", costUsd: null };
      }
    },
  };
};
