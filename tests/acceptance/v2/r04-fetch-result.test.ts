// 要件4 取得の結果（手続き）: 4.1・4.2・4.3・4.6・4.7・4.8・4.9・4.10・4.12。画面は r04-fetch-result.ui.test.tsx。4.13 は段3（本人）。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { approvedStore, fetchOffers, makeCtx, north, publishOffer, registerCustomer, selectionText, SHIBUYA, type Ctx } from "./_fakes";

describeTask("11", "取得の結果", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  const makeStores = async (n: number, prefix: string) => {
    const out: Array<{ id: string; offerId: string }> = [];
    for (let i = 0; i < n; i++) {
      const s = await approvedStore(ctx, { name: `${prefix}${i}`, address: `${prefix}住所${i}`, ...north(SHIBUYA, 60 * i + 5), coupons: i === 0 ? [{ name: "先に作った", note: "1組1回" }, { name: "後に作った", note: "" }] : [], url: i === 1 ? null : `https://example.com/${prefix}${i}` });
      const offer = await publishOffer(s.api, { capacity: 3, partyMax: 4, couponIds: s.coupons.map((c) => c.id) });
      out.push({ id: s.id, offerId: offer.id });
    }
    return out;
  };

  it("4.1・4.2・4.3 候補7件→5件、3件→3件、0件→0件で誤りにならない", async () => {
    const stores = await makeStores(7, "七");
    const c = await registerCustomer(ctx, { phone: "08000000021" });
    const seven = await fetchOffers(c.api, { party: 2 });
    expect(seven.status).toBe(200);
    expect(seven.json.items).toHaveLength(5);
    for (const s of stores.slice(3)) await ctx.admin!.api.post(`/api/admin/stores/${s.id}/ban`, {});
    const three = await fetchOffers(c.api, { party: 2 });
    expect(three.json.items).toHaveLength(3);
    for (const s of stores.slice(0, 3)) await ctx.admin!.api.post(`/api/admin/stores/${s.id}/ban`, {});
    const zero = await fetchOffers(c.api, { party: 2 });
    expect(zero.status).toBe(200);
    expect(zero.json).toMatchObject({ ok: true, items: [] });
  });

  it("4.6・4.7・4.8・4.9・4.10 1件の項目が揃い、クーポンは作った順、徒歩は切り上げ、URL の有無が映る", async () => {
    const stores = await makeStores(2, "二");
    const c = await registerCustomer(ctx, { phone: "08000000022" });
    const r = await fetchOffers(c.api, { party: 2 });
    expect(r.json.items).toHaveLength(2);
    const first = r.json.items.find((i: any) => i.storeId === stores[0].id);
    expect(first).toMatchObject({ offerId: stores[0].offerId, storeName: "二0", walkMinutes: 1, budgetMin: 2000, budgetMax: 4000, partyMax: 4, storeUrl: "https://example.com/二0" });
    expect(typeof first.reason).toBe("string");
    expect(first.reason.length).toBeGreaterThan(0);
    expect(first.coupons).toEqual([{ name: "先に作った", note: "1組1回" }, { name: "後に作った", note: "" }]);
    const second = r.json.items.find((i: any) => i.storeId === stores[1].id);
    expect(second.storeUrl).toBeNull();
    expect(second.walkMinutes).toBe(1);
    expect(second.coupons).toEqual([]);
    const far = await approvedStore(ctx, { name: "遠い", address: "遠い住所", ...north(SHIBUYA, 650) });
    await publishOffer(far.api);
    const r2 = await fetchOffers(c.api, { party: 2 });
    expect(r2.json.items.find((i: any) => i.storeId === far.id).walkMinutes).toBe(9);
  });

  it("4.12 並びは点数→距離→登録の古さの順（AI が違う順で返しても）", async () => {
    const other = await makeCtx();
    try {
      const a = await approvedStore(other, { name: "近い和食", address: "a", ...north(SHIBUYA, 10), genres: ["和食"] });
      const b = await approvedStore(other, { name: "遠い和食", address: "b", ...north(SHIBUYA, 300), genres: ["和食"] });
      const d = await approvedStore(other, { name: "近い中華", address: "d", ...north(SHIBUYA, 10), genres: ["中華"] });
      for (const s of [a, b, d]) await publishOffer(s.api);
      other.ai.respond((input) => ({ ok: true, text: selectionText([...input.stores].reverse().map((s) => ({ storeId: s.id, reason: "合います" }))), costUsd: 0 }));
      const c = await registerCustomer(other, { phone: "08000000023" });
      const r = await fetchOffers(c.api, { party: 2, genres: ["和食"] });
      expect(r.json.items.map((i: any) => i.storeId)).toEqual([a.id, b.id, d.id]);
      const r2 = await fetchOffers(c.api, { party: 2, genres: ["中華"] });
      expect(r2.json.items.map((i: any) => i.storeId)).toEqual([d.id, a.id, b.id]);
    } finally {
      await other.dispose();
    }
  });
});
