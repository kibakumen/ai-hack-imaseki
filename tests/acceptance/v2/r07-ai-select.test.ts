// 要件7 AI の選定と理由。純粋（7.3・7.4・7.5・7.7・7.8）はタスク10、手続きと OrcaRouter の口はタスク11。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { approvedStore, fetchOffers, loadWeb, makeCtx, north, one, publishOffer, registerCustomer, rows, selectionText, SHIBUYA, type Ctx } from "./_fakes";

const IDS = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"];
const pick = (n: number, reason = "近くて好みに合います") => IDS.slice(0, n).map((storeId) => ({ storeId, reason }));

describeTask("10", "AI の出力の検査と点数順への倒し方（純粋）", () => {
  it("7.3 渡していない店・6件・同じ店2回・空の理由は検査に落ち、5件以内で正しければ通る", async () => {
    const { validateSelection } = await loadWeb("lib/domain/selection");
    expect(validateSelection(selectionText(pick(5)), IDS).ok).toBe(true);
    expect(validateSelection(selectionText(pick(1)), IDS).ok).toBe(true);
    expect(validateSelection(selectionText([{ storeId: "unknown", reason: "x" }]), IDS).ok).toBe(false);
    expect(validateSelection(selectionText(pick(6)), IDS).ok).toBe(false);
    expect(validateSelection(selectionText([...pick(1), ...pick(1)]), IDS).ok).toBe(false);
    expect(validateSelection(selectionText([{ storeId: "s1", reason: "" }]), IDS).ok).toBe(false);
    expect(validateSelection(selectionText([{ storeId: "s1", reason: "   " }]), IDS).ok).toBe(false);
    expect(validateSelection("これは JSON ではない", IDS).ok).toBe(false);
    expect(validateSelection("```json\n" + selectionText(pick(2)) + "\n```", IDS).ok).toBe(true);
  });

  it("7.4 理由が 2文・61字・改行ありは落ち、60字・1文は通る", async () => {
    const { validateSelection } = await loadWeb("lib/domain/selection");
    expect(validateSelection(selectionText(pick(1, "あ".repeat(60))), IDS).ok).toBe(true);
    expect(validateSelection(selectionText(pick(1, "あ".repeat(61))), IDS).ok).toBe(false);
    expect(validateSelection(selectionText(pick(1, "近いです。安いです。")), IDS).ok).toBe(false);
    expect(validateSelection(selectionText(pick(1, "近い\n安い")), IDS).ok).toBe(false);
    expect(validateSelection(selectionText(pick(1, "近くて安いです。")), IDS).ok).toBe(true);
  });

  it("7.5・7.7・7.8 0件の選定は0件として通る。倒すときは点数順の上位5件（あるだけ）と決まった文", async () => {
    const { validateSelection, fallbackResult } = await loadWeb("lib/domain/selection");
    const { TEXTS } = await loadWeb("lib/domain/texts");
    const zero = validateSelection(selectionText([]), IDS);
    expect(zero.ok).toBe(true);
    expect(zero.items).toEqual([]);
    const fb = fallbackResult(IDS);
    expect(fb.map((x: any) => x.storeId)).toEqual(IDS.slice(0, 5));
    for (const x of fb) expect(x.reason).toBe(TEXTS.fallbackReason);
    expect(fallbackResult(IDS.slice(0, 3)).map((x: any) => x.storeId)).toEqual(["s1", "s2", "s3"]);
    expect(fallbackResult([])).toEqual([]);
  });
});

describeTask("11", "AI の呼び出し（手続き）と OrcaRouter の口", () => {
  let ctx: Ctx;
  const storeIds: string[] = [];
  beforeAll(async () => {
    ctx = await makeCtx();
    for (let i = 0; i < 12; i++) {
      const s = await approvedStore(ctx, { name: `店${i}`, address: `住所${i}`, ...north(SHIBUYA, i * 40), genres: [i % 2 ? "和食" : "中華"], menus: [`名物${i}`], budgetMin: 1000 + i * 100, budgetMax: 3000 + i * 100 });
      await publishOffer(s.api, { capacity: 3, partyMax: 4 });
      storeIds.push(s.id);
    }
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  const newCustomer = async (i: number) => registerCustomer(ctx, { nickname: `客${i}`, phone: `0800000${String(i).padStart(4, "0")}` });

  it("7.1・7.2 渡った中身（店のジャンル・おすすめメニュー・予算の幅、客の好み・予算・人数）。候補が何件でも呼び出しは1回", async () => {
    const c = await newCustomer(1);
    const before = ctx.ai.calls.length;
    const r = await fetchOffers(c.api, { party: 3, genres: ["和食"], budgetMax: 3500 });
    expect(r.status).toBe(200);
    expect(ctx.ai.calls.length).toBe(before + 1);
    const input = ctx.ai.calls.at(-1)!;
    expect(input).toMatchObject({ party: 3, genres: ["和食"], budgetMax: 3500 });
    expect(input.stores.length).toBeLessThanOrEqual(10);
    expect(input.stores.length).toBeGreaterThan(5);
    for (const s of input.stores) {
      expect(s.genres.length).toBeGreaterThan(0);
      expect(s.menus.length).toBeGreaterThan(0);
      expect(s.budgetMin).toBeLessThanOrEqual(s.budgetMax);
      expect(storeIds).toContain(s.id);
    }
    const c2 = await newCustomer(2);
    await fetchOffers(c2.api, { party: 2, genres: [], budgetMax: 1050 });
    expect(ctx.ai.calls.length).toBe(before + 2);
    expect(ctx.ai.calls.at(-1)!.stores.length).toBeLessThan(input.stores.length);
  });

  it("7.11 候補が0件なら AI を呼ばず0件", async () => {
    const c = await newCustomer(3);
    const before = ctx.ai.calls.length;
    const r = await fetchOffers(c.api, { lat: SHIBUYA.lat + 0.5, party: 2 });
    expect(r.json.items).toEqual([]);
    expect(ctx.ai.calls.length).toBe(before);
  });

  it("7.6 偽の AI が失敗／6秒返らない（偽の時計）→ 点数順の上位5件と決まった文。7.9 記録に倒れたことが残る", async () => {
    const { TEXTS } = await loadWeb("lib/domain/texts");
    const c = await newCustomer(4);
    ctx.ai.respond(() => ({ ok: false, error: "upstream 500" }));
    const failed = await fetchOffers(c.api, { party: 2, genres: ["和食"] });
    expect(failed.status).toBe(200);
    expect(failed.json.items).toHaveLength(5);
    for (const i of failed.json.items) expect(i.reason).toBe(TEXTS.fallbackReason);
    let log = await one(ctx.db, "SELECT ai_used FROM fetch_logs WHERE id = ?", failed.json.fetchId);
    expect(log.ai_used).toBe(0);

    ctx.ai.respond(() => "hang");
    const pending = fetchOffers(c.api, { party: 2, genres: ["和食"] });
    await ctx.clock.advance(6_100);
    const slow = await pending;
    expect(slow.status).toBe(200);
    expect(slow.json.items.map((i: any) => i.storeId)).toEqual(failed.json.items.map((i: any) => i.storeId));
    for (const i of slow.json.items) expect(i.reason).toBe(TEXTS.fallbackReason);

    ctx.ai.respond((input) => ({ ok: true, text: selectionText([{ storeId: input.stores[2].id, reason: "麺が好みに合います" }]), costUsd: 0.001 }));
    const ok = await fetchOffers(c.api, { party: 2, genres: ["和食"] });
    expect(ok.json.items).toHaveLength(1);
    expect(ok.json.items[0].reason).toBe("麺が好みに合います");
    log = await one(ctx.db, "SELECT ai_used FROM fetch_logs WHERE id = ?", ok.json.fetchId);
    expect(log.ai_used).toBe(1);
  });

  it("7.7 検査に落ちた出力（渡していない店・6件・61字）は点数順に倒れ、ai_calls に validation_failed が残る", async () => {
    const c = await newCustomer(5);
    for (const text of [selectionText([{ storeId: "not-a-candidate", reason: "x" }]), selectionText(Array.from({ length: 6 }, (_, i) => ({ storeId: storeIds[i], reason: "x" }))), selectionText([{ storeId: storeIds[1], reason: "あ".repeat(61) }])]) {
      ctx.ai.respond(() => ({ ok: true, text, costUsd: 0.001 }));
      const r = await fetchOffers(c.api, { party: 2, genres: ["和食"] });
      expect(r.status).toBe(200);
      expect(r.json.items.length).toBe(5);
      expect((await one(ctx.db, "SELECT ai_used FROM fetch_logs WHERE id = ?", r.json.fetchId)).ai_used).toBe(0);
    }
    const calls = await rows(ctx.db, "SELECT succeeded, validation_failed FROM ai_calls ORDER BY rowid DESC LIMIT 3");
    for (const call of calls) expect(call).toMatchObject({ succeeded: 1, validation_failed: 1 });
  });

  it("4.12 AI の順ではなく点数順に並ぶ", async () => {
    const c = await newCustomer(6);
    ctx.ai.respond((input) => ({ ok: true, text: selectionText([input.stores[4], input.stores[0], input.stores[2]].map((s) => ({ storeId: s.id, reason: "合います" }))), costUsd: 0.001 }));
    const r = await fetchOffers(c.api, { party: 2, genres: ["和食"] });
    const ids = r.json.items.map((i: any) => i.storeId);
    const input = ctx.ai.calls.at(-1)!;
    expect(ids).toEqual([input.stores[0].id, input.stores[2].id, input.stores[4].id]);
  });

  it("34.3 OrcaRouter の口を本物のまま fetch を差し替えて走らせ、叩かれたホストが OrcaRouter だけ。実費と応答ヘッダーを読む", async () => {
    const { createOrcaRouterSelector } = await loadWeb("lib/adapters/orcarouter");
    const hosts: string[] = [];
    let captured: any = null;
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : (input as Request).url ?? String(input));
      hosts.push(url.host);
      captured = { headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({ choices: [{ message: { content: selectionText([{ storeId: "s1", reason: "近いです" }]) } }], usage: { cost_usd: 0.0042 } }), {
        status: 200,
        headers: { "content-type": "application/json", "X-Orca-Resolved-Model": "openai/gpt-4o-mini", "X-Orca-Request-Id": "req-123", "X-Orca-Fallback-Level": "0" },
      });
    }) as typeof fetch;
    const selector = createOrcaRouterSelector({ apiKey: "test-key", model: "orcarouter/ai-sekitori", fetch: fakeFetch });
    const result = await selector.select({ party: 2, genres: ["和食"], budgetMax: 3000, stores: [{ id: "s1", genres: ["和食"], menus: ["刺身"], budgetMin: 1000, budgetMax: 3000 }] }, {});
    expect(hosts).toEqual(["api.orcarouter.ai"]);
    expect(captured.headers.get("authorization")).toBe("Bearer test-key");
    expect(captured.body.model).toBe("orcarouter/ai-sekitori");
    expect(captured.body.tools).toBeUndefined();
    expect(captured.body.tool_choice).toBeUndefined();
    expect(JSON.stringify(captured.body)).toContain("刺身");
    expect(result).toMatchObject({ ok: true, costUsd: 0.0042 });
    expect(result.text).toContain("近いです");
  });

  it("Guardrails に弾かれた 400 guardrail_blocked も点数順に倒れ、例外が外へ出ず、ai_calls に succeeded=0 が残る", async () => {
    const { createOrcaRouterSelector } = await loadWeb("lib/adapters/orcarouter");
    const { TEXTS } = await loadWeb("lib/domain/texts");
    const blockedFetch = (async () => new Response(JSON.stringify({ error: { code: "guardrail_blocked", message: "blocked" } }), { status: 400, headers: { "content-type": "application/json" } })) as typeof fetch;
    const selector = createOrcaRouterSelector({ apiKey: "k", model: "orcarouter/auto", fetch: blockedFetch });
    const direct = await selector.select({ party: 2, genres: [], budgetMax: null, stores: [{ id: "s1", genres: ["和食"], menus: [], budgetMin: 1, budgetMax: 2 }] }, {});
    expect(direct.ok).toBe(false);
    const other = await ctx.withDeps({ ai: selector });
    const c = await registerCustomer(other, { nickname: "ぶろっく", phone: "08000009999" });
    const r = await fetchOffers(c.api, { party: 2, genres: ["和食"] });
    expect(r.status).toBe(200);
    expect(r.json.items).toHaveLength(5);
    for (const i of r.json.items) expect(i.reason).toBe(TEXTS.fallbackReason);
    expect((await one(ctx.db, "SELECT ai_used FROM fetch_logs WHERE id = ?", r.json.fetchId)).ai_used).toBe(0);
    expect((await one(ctx.db, "SELECT succeeded FROM ai_calls WHERE fetch_id = ?", r.json.fetchId)).succeeded).toBe(0);
  });
});
