// AI の口の検査（基準 34.3・34.4 と、設計書「OrcaRouter の使い方」の①②③）。
// 外へは1バイトも出さず、fetch を差し替えて「何を送り、何を読むか」だけを見る。
//
// ⚠️ この検査のファイルに URL の文字列を書かない（在ってよいのは orcarouter.ts だけ・構造の検査）。
// 呼び先は ORCAROUTER_ENDPOINT を読んで突き合わせる。

import { describe, expect, it } from "vitest";
import { createOrcaRouterPitchWriter, createOrcaRouterSelector, FALLBACK_MODEL, JUDGE_MODEL, ORCAROUTER_ENDPOINT, PITCH_MAX_TOKENS, JUDGE_MAX_TOKENS } from "./orcarouter";
import type { AiSelectInput, PitchInput } from "../ports";

const INPUT: AiSelectInput = {
  party: 2,
  genres: ["和食"],
  budgetMax: 3000,
  stores: [{ id: "s1", genres: ["和食"], menus: ["刺身盛り"], budgetMin: 1000, budgetMax: 3000 }],
};

const okBody = (content: string, costUsd: number | null = 0.0042) =>
  JSON.stringify({ choices: [{ message: { content } }], ...(costUsd === null ? {} : { usage: { cost_usd: costUsd } }) });

type Captured = { url: string; headers: Headers; body: Record<string, unknown> };

/** 1回の呼び出しを捕まえる偽の fetch。 */
const capturing = (respond: () => Response): { calls: Captured[]; fetch: typeof fetch } => {
  const calls: Captured[] = [];
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return respond();
  }) as typeof fetch;
  return { calls, fetch: fake };
};

const jsonResponse = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });

describe("OrcaRouter の口", () => {
  it("34.3 呼び先は OrcaRouter だけ。鍵とモデルと店の姿を送り、実費と応答ヘッダーの3列を読む", async () => {
    const { calls, fetch: fake } = capturing(() =>
      jsonResponse(okBody(JSON.stringify({ selections: [{ storeId: "s1", reason: "近いです" }] })), {
        headers: { "X-Orca-Resolved-Model": "openai/gpt-4o-mini", "X-Orca-Request-Id": "req-123", "X-Orca-Fallback-Level": "0" },
      }),
    );
    const result = await createOrcaRouterSelector({ apiKey: "test-key", model: "orcarouter/ai-sekitori", fetch: fake }).select(INPUT, {});

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(ORCAROUTER_ENDPOINT);
    expect(new URL(calls[0].url).host).toBe(new URL(ORCAROUTER_ENDPOINT).host);
    expect(calls[0].headers.get("authorization")).toBe("Bearer test-key");
    expect(calls[0].body.model).toBe("orcarouter/ai-sekitori");
    // 店が書いた文（おすすめメニュー）が渡っている
    expect(JSON.stringify(calls[0].body)).toContain("刺身盛り");
    expect(result).toMatchObject({ ok: true, costUsd: 0.0042, resolvedModel: "openai/gpt-4o-mini", requestId: "req-123", fallbackLevel: 0 });
    expect(result.ok && result.text).toContain("近いです");
  });

  it("AI に道具を持たせない（要求の本文に道具の指定が1つも無い）", async () => {
    const { calls, fetch: fake } = capturing(() => jsonResponse(okBody("{}")));
    await createOrcaRouterSelector({ apiKey: "k", model: "orcarouter/auto", fetch: fake }).select(INPUT, {});
    // 「tool」で始まる項目（道具の一覧・選び方）がどこにも無い
    expect(JSON.stringify(calls[0].body)).not.toContain("tool");
  });

  it("受け皿（順に試す配列と切り替えの指定）が入り、末尾は別ベンダーの1本", async () => {
    for (const model of ["orcarouter/ai-sekitori", "orcarouter/auto"]) {
      const { calls, fetch: fake } = capturing(() => jsonResponse(okBody("{}")));
      await createOrcaRouterSelector({ apiKey: "k", model, fetch: fake }).select(INPUT, {});
      const models = calls[0].body.models as string[];
      expect(calls[0].body.route).toBe("fallback");
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeLessThanOrEqual(5);
      expect(models[0]).toBe(model);
      expect(models.at(-1)).toBe(FALLBACK_MODEL);
      expect(models.some((m) => /^anthropic\//.test(m))).toBe(true);
    }
  });

  it("応答ヘッダーが無ければ3列は空のまま（0 や空文字に補わない）", async () => {
    const { fetch: fake } = capturing(() => jsonResponse(okBody("{}")));
    const result = await createOrcaRouterSelector({ apiKey: "k", model: "orcarouter/auto", fetch: fake }).select(INPUT, {});
    expect(result).toMatchObject({ ok: true, resolvedModel: null, requestId: null, fallbackLevel: null });
  });

  it("Guardrails の 400・上流の 5xx・中身が空・通信の失敗は、どれも例外を出さずに失敗として返る", async () => {
    const blocked = await createOrcaRouterSelector({
      apiKey: "k",
      model: "orcarouter/auto",
      fetch: (async () => jsonResponse(JSON.stringify({ error: { code: "guardrail_blocked", message: "blocked" } }), { status: 400 })) as typeof fetch,
    }).select(INPUT, {});
    expect(blocked).toEqual({ ok: false, error: "guardrail_blocked", costUsd: null });

    const upstream = await createOrcaRouterSelector({ apiKey: "k", model: "orcarouter/auto", fetch: (async () => new Response("bad gateway", { status: 502 })) as typeof fetch }).select(INPUT, {});
    expect(upstream).toMatchObject({ ok: false, error: "http_502" });

    const empty = await createOrcaRouterSelector({ apiKey: "k", model: "orcarouter/auto", fetch: (async () => jsonResponse(okBody("", 0.001))) as typeof fetch }).select(INPUT, {});
    expect(empty).toEqual({ ok: false, error: "empty_content", costUsd: 0.001 });

    const down = await createOrcaRouterSelector({
      apiKey: "k",
      model: "orcarouter/auto",
      fetch: (async () => {
        throw new Error("connection reset");
      }) as typeof fetch,
    }).select(INPUT, {});
    expect(down).toEqual({ ok: false, error: "network", costUsd: null });
  });

  it("思考トークンを止める指定と出力の上限が入る（速成版の実測: 7.9秒→1.0秒・費用は約1/17）", async () => {
    const { calls, fetch: fake } = capturing(() => jsonResponse(okBody("{}")));
    await createOrcaRouterSelector({ apiKey: "k", model: "orcarouter/ai-sekitori", fetch: fake }).select(INPUT, {});
    expect(calls[0].body.extra_body).toEqual({ google: { thinking_config: { thinking_budget: 0 } } });
    expect(typeof calls[0].body.max_tokens).toBe("number");
    expect(calls[0].body.max_tokens as number).toBeGreaterThan(0);
  });

  it("上限で打ち切られた応答（finish_reason が length）は失敗として返る（途中で切れた JSON を検査へ回さない）", async () => {
    const truncated = JSON.stringify({ choices: [{ message: { content: '{"selections":[{"storeId":"s1","reas' }, finish_reason: "length" }], usage: { cost_usd: 0.003 } });
    const result = await createOrcaRouterSelector({ apiKey: "k", model: "orcarouter/auto", fetch: (async () => jsonResponse(truncated)) as typeof fetch }).select(INPUT, {});
    expect(result).toEqual({ ok: false, error: "length", costUsd: 0.003 });
  });

  it("打ち切りの合図をそのまま外の呼び出しへ渡す（呼ぶ側が6秒を持つ）", async () => {
    const controller = new AbortController();
    let passed: AbortSignal | null | undefined = null;
    const fake = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      passed = init?.signal;
      return jsonResponse(okBody("{}"));
    }) as typeof fetch;
    await createOrcaRouterSelector({ apiKey: "k", model: "orcarouter/auto", fetch: fake }).select(INPUT, { signal: controller.signal });
    expect(passed).toBe(controller.signal);
  });
});

const PITCH: PitchInput = {
  party: 2,
  genres: ["和食"],
  budgetMax: 4000,
  store: { name: "海鮮どんぶり亭", genres: ["和食"], menus: ["刺身盛り"], walkMinutes: 3, budgetMin: 2000, budgetMax: 4000, couponName: "生ビール1杯", couponNote: "1組1回" },
  charLimit: 120,
  critique: null,
};

describe("紹介文の口（書き手と検査官）", () => {
  it("書き手には人格の指示・店の姿・思考を止める指定・生成の上限が渡る", async () => {
    const { calls, fetch: fake } = capturing(() => jsonResponse(okBody("歩いて4分、今日は刺身盛りを出してるよ")));
    const result = await createOrcaRouterPitchWriter({ apiKey: "k", model: "orcarouter/ai-sekitori", fetch: fake }).write(PITCH, {});
    expect(calls[0].url).toBe(ORCAROUTER_ENDPOINT);
    expect(calls[0].body.model).toBe("orcarouter/ai-sekitori");
    expect((calls[0].body.models as string[]).at(-1)).toBe(FALLBACK_MODEL);
    expect(calls[0].body.max_tokens).toBe(PITCH_MAX_TOKENS);
    expect(calls[0].body.extra_body).toEqual({ google: { thinking_config: { thinking_budget: 0 } } });
    const sent = JSON.stringify(calls[0].body);
    expect(sent).toContain("刺身盛り");
    expect(sent).toContain("アメリカ人の友人");
    expect(sent).not.toContain("tool");
    expect(result).toMatchObject({ ok: true, text: "歩いて4分、今日は刺身盛りを出してるよ", truncated: false });
  });

  it("書き直しのときだけ、直前の案が落ちた理由が指示に入る", async () => {
    const { calls, fetch: fake } = capturing(() => jsonResponse(okBody("焼きたての香りが心地よい一軒です")));
    const writer = createOrcaRouterPitchWriter({ apiKey: "k", model: "orcarouter/ai-sekitori", fetch: fake });
    await writer.write(PITCH, {});
    await writer.write({ ...PITCH, critique: "口コミに触れていた" }, {});
    expect(JSON.stringify(calls[0].body)).not.toContain("却下");
    expect(JSON.stringify(calls[1].body)).toContain("口コミに触れていた");
  });

  it("検査官は別ベンダーの Named Router へ行き、温度は低く・上限は検査用。指示に「評価」の語を入れない", async () => {
    const { calls, fetch: fake } = capturing(() => jsonResponse(okBody('{"ok":true,"reason":""}')));
    const judged = await createOrcaRouterPitchWriter({ apiKey: "k", model: "orcarouter/ai-sekitori", fetch: fake }).judge(
      { text: "歩いて4分、今日は刺身盛りを出してるよ", store: { name: "海鮮どんぶり亭", genres: ["和食"], menus: ["刺身盛り"], couponName: null } },
      {},
    );
    expect(calls[0].body.model).toBe(JUDGE_MODEL);
    expect(calls[0].body.models).toEqual([JUDGE_MODEL]);
    expect(calls[0].body.max_tokens).toBe(JUDGE_MAX_TOKENS);
    expect(calls[0].body.temperature as number).toBeLessThan(0.2);
    // ⚠️ 判定役（openai/gpt-4o-mini）に思考を止める指定を送ると 400 で丸ごと落ちる（2026-09-22 実測）
    expect(calls[0].body.extra_body).toBeUndefined();
    const system = (calls[0].body.messages as Array<{ role: string; content: string }>)[0].content;
    expect(system).not.toContain("評価");
    expect(judged).toMatchObject({ ok: true });
  });

  it("鍵の scope で検査官が 403 になったら、生成と同じ Named Router で検査し直し、しばらくは直接そちらへ行く", async () => {
    const calls: Captured[] = [];
    const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ url: String(input), headers: new Headers(init?.headers), body });
      if (body.model === JUDGE_MODEL) return jsonResponse(JSON.stringify({ error: { code: "model_access_denied" } }), { status: 403 });
      return jsonResponse(okBody('{"ok":true,"reason":""}'));
    }) as typeof fetch;
    const writer = createOrcaRouterPitchWriter({ apiKey: "k", model: "orcarouter/ai-sekitori", fetch: fake });
    const first = await writer.judge({ text: "文", store: { name: "店", genres: [], menus: [], couponName: null } }, {});
    expect(first).toMatchObject({ ok: true });
    expect(calls.map((c) => c.body.model)).toEqual([JUDGE_MODEL, "orcarouter/ai-sekitori"]);
    // 2回目は 403 を踏みに行かない（1店ごとに無駄な往復をしない）
    await writer.judge({ text: "文", store: { name: "店", genres: [], menus: [], couponName: null } }, {});
    expect(calls.map((c) => c.body.model)).toEqual([JUDGE_MODEL, "orcarouter/ai-sekitori", "orcarouter/ai-sekitori"]);
  });
});

describe("思考を止める指定を上流が知らなかったとき", () => {
  it("『Unrecognized request argument supplied: extra_body』の 400 なら、指定を外して1回だけやり直す", async () => {
    const calls: Captured[] = [];
    const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ url: String(input), headers: new Headers(init?.headers), body });
      if (body.extra_body !== undefined) {
        return jsonResponse(JSON.stringify({ error: { message: "Unrecognized request argument supplied: extra_body", type: "invalid_request_error", code: null } }), { status: 400 });
      }
      return jsonResponse(okBody(JSON.stringify({ selections: [{ storeId: "s1", reason: "近いです" }] })));
    }) as typeof fetch;
    const result = await createOrcaRouterSelector({ apiKey: "k", model: "orcarouter/auto", fetch: fake }).select(INPUT, {});
    expect(result).toMatchObject({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[0].body.extra_body).toBeDefined();
    expect(calls[1].body.extra_body).toBeUndefined();
    // 中身（モデル・受け皿・上限・messages）はやり直しても同じ
    expect(calls[1].body.model).toBe(calls[0].body.model);
    expect(calls[1].body.models).toEqual(calls[0].body.models);
    expect(calls[1].body.max_tokens).toBe(calls[0].body.max_tokens);
  });

  it("ほかの 400（Guardrails）ではやり直さない", async () => {
    const calls: Captured[] = [];
    const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return jsonResponse(JSON.stringify({ error: { code: "guardrail_blocked", message: "blocked" } }), { status: 400 });
    }) as typeof fetch;
    const result = await createOrcaRouterSelector({ apiKey: "k", model: "orcarouter/auto", fetch: fake }).select(INPUT, {});
    expect(result).toEqual({ ok: false, error: "guardrail_blocked", costUsd: null });
    expect(calls).toHaveLength(1);
  });
});
