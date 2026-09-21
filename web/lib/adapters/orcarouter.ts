// AI の呼び出しの実物（差し替え口 AiSelector・PitchWriter の OrcaRouter 版）。**AI を呼ぶ URL が在るのはここだけ**
// （基準 34.3・34.4・構造の検査が見張る）。呼び方は速成版 `sprint/lib/llm.ts` の実績のある形を写した。
//
// AI は道具（tool）を1つも持たない（設計書「AI まわりの守り」の1段目）。だから要求の本文に道具の
// 一覧も選び方も入れない。出力として通るのは domain/selection・domain/pitch の検査を通ったものだけで、
// 並び順すら AI から取らない（基準 4.12）。
//
// 打ち切り（基準 7.6 の6秒）は呼ぶ側（usecases/fetchOffers）が AbortSignal で渡す——この口は
// 時間を数えない（時計を知らないため・依存の向き）。

import type { AiSelectInput, AiSelectResult, AiSelector, PitchInput, PitchJudgeInput, PitchResult, PitchWriter } from "../ports";

/** AI を呼ぶ URL（基準 34.3・34.4: 在るのはこのファイルだけ。検査はここを読んで突き合わせる）。 */
export const ORCAROUTER_ENDPOINT = "https://api.orcarouter.ai/v1/chat/completions";

/**
 * 受け皿（設計書「OrcaRouter の使い方」②）。候補に入れていない**別ベンダー**の1本で、
 * 上流の 5xx・429・通信断のときだけ OrcaRouter の側が切り替える。
 * ⚠️ 綴りはカタログの実物（ドット。`claude-haiku-4-5` ではない）。
 */
export const FALLBACK_MODEL = "anthropic/claude-haiku-4.5";

/**
 * 紹介文の検査役（2026-09-21 に本人が OrcaRouter コンソールで作った Named Router・許可モデルは
 * `openai/gpt-4o-mini` の1本）。生成は `orcarouter/ai-sekitori`（→ google/gemini-2.5-flash）なので、
 * **書き手と検査官が別ベンダー**になる（作った本人に採点させない）。
 * 生のモデル名は鍵の scope で 403 になるため、Named Router 経由で呼ぶのが唯一の道（実測 2026-09-21）。
 */
export const JUDGE_MODEL = "orcarouter/akiseki-judge";

/**
 * 思考トークンを止める（速成版 `lib/llm.ts:38` の実測: gemini-2.5-flash は短い1文にも
 * reasoning を約1000トークン使い、1回 6〜8秒・$0.0026 かかっていた。これを渡すと
 * 0.7〜1.1秒・$0.00015 に下がり、本文の質は保たれた——2026-09-22 に v2 でも実測 0.8秒・$0.000166）。
 *
 * ⚠️ **黙って無視されるわけではない**（2026-09-22 に実物へ当てて判明）。OrcaRouter はこの項目を
 * 上流へそのまま渡すので、**OpenAI 系に解決されると 400**
 * （`Unrecognized request argument supplied: extra_body`）で**丸ごと落ちる**。
 * だから ①google 系に行く呼び出しにだけ付ける（判定役の `orcarouter/akiseki-judge` は
 * `openai/gpt-4o-mini` なので付けない）②それでも 400 が返ったら指定を外して1回だけやり直す。
 */
const NO_THINKING_EXTRA_BODY = { google: { thinking_config: { thinking_budget: 0 } } };

/** 上流が `extra_body` を知らなかった印（この時だけ、指定を外してやり直す）。 */
const UNSUPPORTED_EXTRA_BODY = "unsupported_extra_body";

/**
 * 出力の上限（速成版 `lib/personaPitch.ts:45-46` の実測: 思考を止めた状態で生成 25〜36 トークン・
 * 検査 26 トークン。切れないよう十分に上を取る）。**上限で打ち切られた文は途中で切れている**ので、
 * 呼ぶ側が字数の検査で見つけられない——`finish_reason === "length"` をここで失敗に倒す。
 */
export const SELECT_MAX_TOKENS = 800;
export const PITCH_MAX_TOKENS = 512;
export const JUDGE_MAX_TOKENS = 400;

/** 判定役が鍵の scope で 403 になったとき、次に試すまで覚えておく時間（店ごとに毎回踏まない） */
const JUDGE_DENIED_MEMO_MS = 10 * 60 * 1000;
/** 鍵の scope で断られた印（OrcaRouter が返す語） */
const MODEL_ACCESS_DENIED = "model_access_denied";

export type OrcaRouterConfig = {
  apiKey: string;
  /** 呼ぶモデル。提出版は Named Router `orcarouter/ai-sekitori`（設定 ORCAROUTER_MODEL・adapters/env.ts） */
  model: string;
  /** 差し替えるための口（検査が偽物を渡す）。既定は実物 */
  fetch?: typeof fetch;
};

type ChatResponse = {
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>;
  usage?: { cost_usd?: unknown };
  error?: { code?: unknown; message?: unknown };
};

/** 1回の呼び出しの注文（どのモデルに・何を・どれだけの長さで聞くか）。 */
type CallRequest = {
  model: string;
  /** 受け皿の並び（先頭が第一希望）。1本だけ渡せば受け皿なし */
  models: string[];
  system: string;
  user: string;
  temperature: number;
  maxTokens: number;
  /** 思考トークンを止める指定を付けるか（google 系に行く呼び出しだけ true） */
  noThinking: boolean;
};

type CallOutcome =
  | { ok: true; text: string; costUsd: number | null; truncated: boolean; resolvedModel: string | null; requestId: string | null; fallbackLevel: number | null }
  | { ok: false; error: string; costUsd: number | null };

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
    if (typeof body.error?.code === "string") return body.error.code;
    // 上流が知らない項目を送った 400（実測: OpenAI は `extra_body` をこの形で断る。`code` は null）
    if (typeof body.error?.message === "string" && body.error.message.includes("extra_body")) return UNSUPPORTED_EXTRA_BODY;
    return `http_${res.status}`;
  } catch {
    return `http_${res.status}`;
  }
};

/**
 * OrcaRouter を1回呼ぶ（選定も紹介文も検査も、外へ出る道はこの関数ひとつ）。
 * 例外は外へ出さない——打ち切り（AbortSignal）も通信の失敗も「失敗」として返す。
 */
const sendOnce = async (config: OrcaRouterConfig, request: CallRequest, opts: { signal?: AbortSignal }, noThinking: boolean): Promise<CallOutcome> => {
  const send = config.fetch ?? fetch;
  try {
    const res = await send(ORCAROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
        "X-OrcaRouter-Include-Cost": "true",
      },
      body: JSON.stringify({
        model: request.model,
        // 受け皿（順に試す配列＋切り替えの指定）。発火するのは上流の 5xx・429・通信断だけ。
        models: request.models,
        route: "fallback",
        messages: [
          { role: "system", content: request.system },
          { role: "user", content: request.user },
        ],
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        ...(noThinking ? { extra_body: NO_THINKING_EXTRA_BODY } : {}),
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
      // 上限で打ち切られた（"length"）文は途中で切れている。字数の検査は通ってしまうので、呼ぶ側が落とせるように渡す
      truncated: body.choices?.[0]?.finish_reason === "length",
      // 応答ヘッダーの3列（無ければ NULL のまま——0 や空文字に補わない）
      resolvedModel: res.headers.get("X-Orca-Resolved-Model"),
      requestId: res.headers.get("X-Orca-Request-Id"),
      fallbackLevel: numberOrNull(res.headers.get("X-Orca-Fallback-Level")),
    };
  } catch {
    // 打ち切り（AbortSignal）も通信の失敗も、例外を外へ出さずに「失敗」として返す。
    return { ok: false, error: "network", costUsd: null };
  }
};

/**
 * 1回の呼び出し。思考を止める指定を上流が知らなかった（400）ときだけ、その指定を外して
 * もう1回やり直す——**速さの工夫のために機能を落とさない**ための受け皿。
 * 受け皿のモデルが別ベンダーに切り替わった時（`route: "fallback"`）にも効く。
 */
const callOrcaRouter = async (config: OrcaRouterConfig, request: CallRequest, opts: { signal?: AbortSignal }): Promise<CallOutcome> => {
  const first = await sendOnce(config, request, opts, request.noThinking);
  if (first.ok || first.error !== UNSUPPORTED_EXTRA_BODY) return first;
  return sendOnce(config, request, opts, false);
};

export const createOrcaRouterSelector = (config: OrcaRouterConfig): AiSelector => ({
  select: async (input, opts): Promise<AiSelectResult> => {
    const outcome = await callOrcaRouter(
      config,
      { model: config.model, models: [config.model, FALLBACK_MODEL], system: SYSTEM_PROMPT, user: userPrompt(input), temperature: 0.2, maxTokens: SELECT_MAX_TOKENS, noThinking: true },
      opts,
    );
    if (!outcome.ok) return { ok: false, error: outcome.error, costUsd: outcome.costUsd };
    // 途中で切れた JSON を検査へ回さない（壊れた JSON として落ちるだけで、実費は同じ）
    if (outcome.truncated) return { ok: false, error: "length", costUsd: outcome.costUsd };
    return { ok: true, text: outcome.text, costUsd: outcome.costUsd, resolvedModel: outcome.resolvedModel, requestId: outcome.requestId, fallbackLevel: outcome.fallbackLevel };
  },
});

// ---------- 人格つきの紹介文（書き手と検査官） ----------

/** 初版のペルソナ（速成版 `lib/personaPitch.ts:16`。本人は今後 X の Roast のような強い個性へ調整したい意向）。 */
export const PERSONA_SYSTEM =
  "あなたは、この街に長く住んでいる飲食店に詳しい地元の常連です。気さくで、少しジェントルな物腰。" +
  "友人に「ここ良いよ」と勧めるような温度感で、店の魅力を一言で伝えてください。";

const writeSystem = (charLimit: number, critique: string | null): string =>
  [
    PERSONA_SYSTEM,
    `${charLimit}字以内の日本語1文で書く。`,
    "口コミ・レビュー・点数・星の数など、渡されていない情報には一切触れない（このシステムにそのデータは存在しないため）。",
    "渡された情報にないメニューや価格を作らない。URLや電話番号は書かない。",
    // 思考を止めていても、指示の側でも短く切り上げさせる（速成版 2026-09-21 の実測）。
    "考えや手順・下書き・言い換え案は書かない。完成した紹介文の1文だけを、そのまま返す。",
    "前置き・見出し・箇条書き・記号・引用符は付けない。",
    critique ? `直前の案は却下された（理由: ${critique}）。同じ問題を避けて書き直す。` : "",
  ]
    .filter(Boolean)
    .join("\n");

const writeUser = (input: PitchInput): string =>
  [
    `客: ${input.party}人。好み: ${input.genres.join("・") || "こだわらない"}。予算の上限: ${input.budgetMax === null ? "指定なし" : `${input.budgetMax}円`}`,
    `店: ${input.store.name}（${input.store.genres.join("・") || "ジャンル不明"}）。徒歩${input.store.walkMinutes}分。1人${input.store.budgetMin}〜${input.store.budgetMax}円。`,
    `おすすめメニュー: ${input.store.menus.join("・") || "情報なし"}`,
    `現在のクーポン: ${input.store.couponName ? `${input.store.couponName}${input.store.couponNote ? `（${input.store.couponNote}）` : ""}` : "なし"}`,
  ].join("\n");

/**
 * 検査官への指示。**「評価」という語を入れない**——速成版 2026-09-21 の実測で、この語のせいで
 * 検査官が「美味しい」を〈存在しないデータ〉とみなし、真っ当な紹介文を落としていた。
 * 落とす条件は3つに限る。
 */
const JUDGE_SYSTEM = [
  "あなたは飲食店の紹介文の検査官です。**合格が既定**で、次の3つのどれかに当たるときだけ不合格にします。",
  "(1) 口コミサイトの点数・星の数・レビュー件数・受賞歴など、渡されていないデータを根拠として挙げている",
  "(2) 渡していないメニュー名・価格・設備（個室・掘りごたつ・駐車場など）を、事実として書いている",
  "(3) 押し売り・不快・倫理的におかしい表現がある",
  "店名・ジャンル・メニュー名・クーポン・徒歩分数・価格帯は渡した事実なので、触れて構いません。",
  // ⚠️ この2行を削らない。2026-09-22 に openai/gpt-4o-mini で実測したとき、これが無いと
  // 「主観的な表現が含まれているため」という理由で真っ当な紹介文を落とした（通すべき3件のうち2件）。
  "書き手の感想・褒め言葉（新鮮・美味しい・絶品・しみじみ・気取らない・ぴったり・自慢 など）は、**それだけでは不合格にしません**。",
  "文が主観的・宣伝的であることを理由に不合格にしてはいけません。見るのは上の3つだけです。",
  '考えを書かず、JSON だけを返します: {"ok":true|false,"reason":"不合格なら短い理由（40字以内）。合格なら空文字"}',
].join("\n");

const judgeUser = (input: PitchJudgeInput): string =>
  [
    "検査対象の文:",
    input.text,
    "渡した事実:",
    `店名=${input.store.name} ジャンル=${input.store.genres.join("・") || "不明"} メニュー=${input.store.menus.join("・") || "なし"} クーポン=${input.store.couponName ?? "なし"}`,
  ].join("\n");

const toPitchResult = (outcome: CallOutcome): PitchResult =>
  outcome.ok
    ? { ok: true, text: outcome.text, costUsd: outcome.costUsd, truncated: outcome.truncated, resolvedModel: outcome.resolvedModel, requestId: outcome.requestId, fallbackLevel: outcome.fallbackLevel }
    : { ok: false, error: outcome.error, costUsd: outcome.costUsd };

/**
 * 人格つきの紹介文を書く口と、それを検査する口（設計書の後段——店の選定とは別の層）。
 *
 * ⚠️ **実物の Deps を組む場所（`app/api` の入口）で渡すこと**:
 * `pitch: createOrcaRouterPitchWriter({ apiKey: env.ORCAROUTER_API_KEY, model: env.ORCAROUTER_MODEL })`
 * 渡さないと紹介文の層は丸ごと走らず、店の選定が書いた理由だけが客に出る（落ちはしない）。
 *
 * 検査官は別ベンダー（JUDGE_MODEL）に頼むが、**本番の鍵の scope では 403 になることがある**。
 * そのときは生成と同じ Named Router で検査し直す——独立性は落ちるが、機能が1度も出ないよりは良い。
 * 本人が OrcaRouter コンソールで scope を足せば、この経路は使われなくなる（再デプロイ不要）。
 */
export const createOrcaRouterPitchWriter = (config: OrcaRouterConfig & { judgeModel?: string }): PitchWriter => {
  const judgeModel = config.judgeModel ?? JUDGE_MODEL;
  // 403 を店ごとに何度も踏まない（1回 約0.2〜0.4秒の無駄）。一定時間だけ覚えて、また試す。
  let judgeDeniedUntil = 0;

  /**
   * 検査官を1回呼ぶ。⚠️ `noThinking` は**判定役のときだけ false**——`orcarouter/akiseki-judge` は
   * `openai/gpt-4o-mini` で、思考を止める指定を送ると 400 で丸ごと落ちる（2026-09-22 実測）。
   * 生成と同じ Named Router（google 系）へ倒したときは付けてよい。
   */
  const judgeWith = (model: string, user: string, opts: { signal?: AbortSignal }, noThinking: boolean): Promise<CallOutcome> =>
    callOrcaRouter(config, { model, models: [model], system: JUDGE_SYSTEM, user, temperature: 0.1, maxTokens: JUDGE_MAX_TOKENS, noThinking }, opts);

  return {
    write: async (input, opts): Promise<PitchResult> =>
      toPitchResult(
        await callOrcaRouter(
          config,
          {
            model: config.model,
            models: [config.model, FALLBACK_MODEL],
            system: writeSystem(input.charLimit, input.critique),
            user: writeUser(input),
            // 人格を出すので温度を上げる（後ろに決定論のガードと検査官が居る）
            temperature: 0.75,
            maxTokens: PITCH_MAX_TOKENS,
            noThinking: true,
          },
          opts,
        ),
      ),

    judge: async (input, opts): Promise<PitchResult> => {
      const user = judgeUser(input);
      if (Date.now() < judgeDeniedUntil) return toPitchResult(await judgeWith(config.model, user, opts, true));
      const first = await judgeWith(judgeModel, user, opts, false);
      if (first.ok || first.error !== MODEL_ACCESS_DENIED) return toPitchResult(first);
      judgeDeniedUntil = Date.now() + JUDGE_DENIED_MEMO_MS;
      return toPitchResult(await judgeWith(config.model, user, opts, true));
    },
  };
};
