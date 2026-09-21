// 要件5 決定論の絞り込み。純粋はタスク10、手続き（5.2・5.7）はタスク11。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { approvedStore, fetchOffers, haversine, loadWeb, makeCtx, MIN, north, publishOffer, registerCustomer, rows, SHIBUYA, type Ctx } from "./_fakes";

const store = (id: string, over: Record<string, unknown> = {}) => ({ id, lat: SHIBUYA.lat, lng: SHIBUYA.lng, partyMax: 4, budgetMin: 1000, budgetMax: 3000, receivable: true, genres: ["和食"], ...over });

describeTask("10", "絞り込み（純粋）", () => {
  it("5.1 800m 以内は残り、801m は落ちる（距離の式は haversine と 0.5m 以内で一致）", async () => {
    const { filterCandidates } = await loadWeb("lib/domain/filter");
    const { distanceMeters } = await loadWeb("lib/domain/geo");
    const p799 = north(SHIBUYA, 799);
    const p801 = north(SHIBUYA, 801);
    expect(Math.abs(distanceMeters(SHIBUYA, p799) - haversine(SHIBUYA, p799))).toBeLessThan(0.5);
    const out = filterCandidates({ origin: SHIBUYA, party: 2, budgetMax: null }, [store("near", p799), store("far", p801), store("here")]);
    expect(out.map((s: any) => s.id).sort()).toEqual(["here", "near"]);
  });

  it("5.3 人数が「何名まで」と同じなら残り、1多いと落ちる", async () => {
    const { filterCandidates } = await loadWeb("lib/domain/filter");
    const out = filterCandidates({ origin: SHIBUYA, party: 4, budgetMax: null }, [store("eq", { partyMax: 4 }), store("less", { partyMax: 3 }), store("more", { partyMax: 5 })]);
    expect(out.map((s: any) => s.id).sort()).toEqual(["eq", "more"]);
    expect(filterCandidates({ origin: SHIBUYA, party: 5, budgetMax: null }, [store("eq", { partyMax: 4 })])).toEqual([]);
  });

  it("5.4・5.5 予算: 上限と店の最低が同じなら残り、店の最低が1円上なら落ちる。上限が未指定なら予算で除かない", async () => {
    const { filterCandidates } = await loadWeb("lib/domain/filter");
    const stores = [store("same", { budgetMin: 3000 }), store("over", { budgetMin: 3001 }), store("cheap", { budgetMin: 500 })];
    expect(filterCandidates({ origin: SHIBUYA, party: 2, budgetMax: 3000 }, stores).map((s: any) => s.id).sort()).toEqual(["cheap", "same"]);
    expect(filterCandidates({ origin: SHIBUYA, party: 2, budgetMax: null }, stores).map((s: any) => s.id).sort()).toEqual(["cheap", "over", "same"]);
    expect(filterCandidates({ origin: SHIBUYA, party: 2, budgetMax: 0 }, stores)).toEqual([]);
  });

  it("5.6 ジャンルが合わなくても残る。5.2 受け取れる状態でない店は落ちる", async () => {
    const { filterCandidates } = await loadWeb("lib/domain/filter");
    const out = filterCandidates({ origin: SHIBUYA, party: 2, budgetMax: null, genres: ["中華"] }, [store("mismatch", { genres: ["和食"] }), store("closed", { receivable: false })]);
    expect(out.map((s: any) => s.id)).toEqual(["mismatch"]);
  });

  it("5.8 同じ入力で毎回同じ集合（順序も同じ）", async () => {
    const { filterCandidates } = await loadWeb("lib/domain/filter");
    const stores = Array.from({ length: 30 }, (_, i) => store(`s${i}`, north(SHIBUYA, (i * 37) % 900)));
    const input = { origin: SHIBUYA, party: 2, budgetMax: 2500 };
    const a = JSON.stringify(filterCandidates(input, stores).map((s: any) => s.id));
    for (let i = 0; i < 5; i++) expect(JSON.stringify(filterCandidates(input, [...stores]).map((s: any) => s.id))).toBe(a);
    expect(JSON.parse(a).length).toBeGreaterThan(5);
    expect(JSON.parse(a).length).toBeLessThan(30);
  });
});

describeTask("11", "絞り込み（手続き）: 公開中×残りの表と、TS と SQL の突き合わせ・AI を呼ばない", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("5.2 候補に入るのは受け取れる状態だけ。TS（isReceivable）と SQL の答えが一致する", async () => {
    const mk = async (name: string) => approvedStore(ctx, { name, address: `住所 ${name}` });
    const stopped = await mk("止めた店");
    await publishOffer(stopped.api);
    await stopped.api.post("/api/store/offers/current/stop", {});
    const timedOut = await mk("時刻を過ぎた店");
    await publishOffer(timedOut.api, { until: "15:05" });
    const banned = await mk("運営が止めた店");
    await publishOffer(banned.api);
    await ctx.admin!.api.post(`/api/admin/stores/${banned.id}/ban`, {});
    const one = await mk("残り1の店");
    await publishOffer(one.api, { capacity: 1 });
    // 残り0の店（受け取られて尽きた）は受け取りのタスク（13）の r08 で見る
    ctx.clock.set(new Date(new Date(ctx.clock.now()).getTime() + 10 * MIN).toISOString());
    const customer = await registerCustomer(ctx, { nickname: "さがすひと", phone: "08000000002" });
    const f = await fetchOffers(customer.api, { party: 2 });
    expect(f.status).toBe(200);
    expect(f.json.items.map((i: any) => i.storeId)).toEqual([one.id]);
    const { isReceivable } = await loadWeb("lib/domain/offer");
    const now = ctx.clock.now();
    const offers = await rows(ctx.db, "SELECT o.id, o.store_id, o.ended_at, o.until_at, o.capacity FROM offers o");
    for (const o of offers) {
      const holding = (await rows(ctx.db, "SELECT status, expires_at, holds_slot FROM reservations WHERE offer_id = ?", o.id)).filter(
        (r: any) => (r.status === "active" && new Date(r.expires_at) > now) || (r.status === "completed" && r.holds_slot === 1) || r.status === "store_cancelled",
      ).length;
      const ts = isReceivable({ endedAt: o.ended_at ? new Date(o.ended_at) : null, untilAt: new Date(o.until_at), remaining: o.capacity - holding }, now);
      expect(ts, o.store_id).toBe(o.store_id === one.id);
    }
  });

  it("5.7・6.6 候補が決まって点数づけが終わるまで、偽の AI の呼び出しが0回。候補0件では AI が呼ばれない", async () => {
    const customer = await registerCustomer(ctx, { nickname: "とおく", phone: "08000000003" });
    const before = ctx.ai.calls.length;
    const far = await fetchOffers(customer.api, { lat: SHIBUYA.lat + 1, lng: SHIBUYA.lng, party: 2 });
    expect(far.status).toBe(200);
    expect(far.json.items).toEqual([]);
    expect(ctx.ai.calls.length).toBe(before);
    ctx.ai.respond(() => {
      throw new Error("AI must not be called during filtering");
    });
    const none = await fetchOffers(customer.api, { party: 10 });
    expect(none.status).toBe(200);
    expect(none.json.items).toEqual([]);
    expect(ctx.ai.calls.length).toBe(before);
  });
});
