// AI の口の検査（基準 34.3・34.4 と、設計書「OrcaRouter の使い方」の①②③）。
// 外へは1バイトも出さず、fetch を差し替えて「何を送り、何を読むか」だけを見る。
//
// ⚠️ この検査のファイルに URL の文字列を書かない（在ってよいのは orcarouter.ts だけ・構造の検査）。
// 呼び先は ORCAROUTER_ENDPOINT を読んで突き合わせる。

import { describe, expect, it } from "vitest";
import { createOrcaRouterSelector, FALLBACK_MODEL, ORCAROUTER_ENDPOINT } from "./orcarouter";
import type { AiSelectInput } from "../ports";

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
