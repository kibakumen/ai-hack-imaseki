// 要件8 受け取りと確保（手続き・純粋）。画面は r08-receive.ui.test.tsx。8.11 は【最終日】タスク30。
// 後のタスクの操作（客の取り消し15・完了済み17・店の取り消し18・運営の停止21）が要る場合は、そのタスクの番号を名乗る。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { approvedStore, fakeRng, fetchOffers, loadWeb, makeCtx, MIN, one, publishOffer, receive, receivedScene, registerCustomer, rows, type Ctx } from "./_fakes";

let seq = 100;
const customer = (ctx: Ctx, over: Record<string, unknown> = {}) => registerCustomer(ctx, { phone: `0801${String(seq++).padStart(7, "0")}`, ...over });
const storeWithOffer = async (ctx: Ctx, over: { capacity?: number; partyMax?: number; name?: string; until?: string } = {}) => {
  const s = await approvedStore(ctx, { name: over.name ?? "受け取りの店" });
  const offer = await publishOffer(s.api, { capacity: over.capacity ?? 3, partyMax: over.partyMax ?? 4, until: over.until ?? "23:00" });
  return { store: s, offer };
};

describeTask("13", "受け取りと確保", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("8.1・8.2・8.4・18.1・27.3 取得の人数を持つ確保が1件でき、8桁の数字のコード、期限は20分後、残りが1減り、選択の記録が1件増える", async () => {
    const { store, offer } = await storeWithOffer(ctx, { capacity: 3 });
    const c = await customer(ctx);
    const f = await fetchOffers(c.api, { party: 3 });
    const selectionsBefore = (await rows(ctx.db, "SELECT id FROM selections")).length;
    const r = await receive(c.api, { offerId: offer.id, party: 3, fetchId: f.json.fetchId });
    expect(r.status).toBe(200);
    expect(r.json.ok).toBe(true);
    expect(r.json.reservation).toMatchObject({ party: 3, storeName: "受け取りの店", status: "active" });
    expect(r.json.reservation.code).toMatch(/^\d{8}$/);
    expect(new Date(r.json.reservation.expiresAt).getTime() - ctx.clock.now().getTime()).toBe(20 * MIN);
    expect(r.json.home.kind).toBe("active");
    expect((await store.api.get("/api/store/home")).json.offer.remaining).toBe(2);
    expect((await rows(ctx.db, "SELECT id FROM selections")).length).toBe(selectionsBefore + 1);
    const sel = await one(ctx.db, "SELECT fetch_id, store_id FROM selections ORDER BY rowid DESC LIMIT 1");
    expect(sel).toMatchObject({ fetch_id: f.json.fetchId, store_id: store.id });
    const events = await rows(ctx.db, "SELECT status FROM reservation_events WHERE reservation_id = ?", r.json.reservation.id);
    expect(events.map((e: any) => e.status)).toEqual(["active"]);
  });

  it("8.3 偽の乱数で同じ値を続けて出すと引き直し、既に在るコードとは重ならない（一意の制約）", async () => {
    const { codeFromBytes } = await loadWeb("lib/domain/code");
    const same = new Uint8Array(16).fill(7);
    const other = new Uint8Array(16).fill(9);
    expect(codeFromBytes(same)).toMatch(/^\d{8}$/);
    expect(codeFromBytes(same)).toBe(codeFromBytes(same));
    expect(codeFromBytes(same)).not.toBe(codeFromBytes(other));
    const rng = fakeRng([same, same, same, other, other]);
    const fixed = await ctx.withDeps({ rng });
    const { offer } = await storeWithOffer(ctx, { capacity: 5 });
    const a = await registerCustomer(fixed, { phone: "08020000001" });
    const fa = await fetchOffers(a.api, { party: 2 });
    const ra = await receive(a.api, { offerId: offer.id, party: 2, fetchId: fa.json.fetchId });
    expect(ra.status).toBe(200);
    expect(ra.json.reservation.code).toBe(codeFromBytes(same));
    const b = await registerCustomer(fixed, { phone: "08020000002" });
    const fb = await fetchOffers(b.api, { party: 2 });
    const rb = await receive(b.api, { offerId: offer.id, party: 2, fetchId: fb.json.fetchId });
    expect(rb.status).toBe(200);
    expect(rb.json.reservation.code).toBe(codeFromBytes(other));
    expect(rng.calls).toBeGreaterThanOrEqual(3);
    expect((await rows(ctx.db, "SELECT code FROM reservations WHERE code = ?", codeFromBytes(same))).length).toBe(1);
  });

  it("8.6 受け取れない状態（残り0・店が止めた・何時までを過ぎた・運営が止めた）・人数超では作られず、理由が場面に合った1つ、nextStep と home が載る", async () => {
    const c = await customer(ctx);
    const cases: Array<{ name: string; make: () => Promise<{ offerId: string; party: number }>; kind: string; partyMax?: number }> = [
      {
        name: "残り0",
        make: async () => {
          const { offer } = await storeWithOffer(ctx, { capacity: 1 });
          const taker = await customer(ctx);
          const f = await fetchOffers(taker.api, { party: 2 });
          await receive(taker.api, { offerId: offer.id, party: 2, fetchId: f.json.fetchId });
          return { offerId: offer.id, party: 2 };
        },
        kind: "sold_out",
      },
      {
        name: "店が止めた",
        make: async () => {
          const { store, offer } = await storeWithOffer(ctx);
          await store.api.post("/api/store/offers/current/stop", {});
          return { offerId: offer.id, party: 2 };
        },
        kind: "offer_ended",
      },
      {
        name: "何時までを過ぎた",
        make: async () => {
          const { offer } = await storeWithOffer(ctx, { until: "15:30" });
          ctx.clock.set("2026-09-22T06:31:00.000Z");
          return { offerId: offer.id, party: 2 };
        },
        kind: "offer_ended",
      },
      {
        name: "運営が止めた",
        make: async () => {
          const { store, offer } = await storeWithOffer(ctx);
          await ctx.admin!.api.post(`/api/admin/stores/${store.id}/ban`, {});
          return { offerId: offer.id, party: 2 };
        },
        kind: "store_banned",
      },
      {
        name: "人数超",
        make: async () => {
          const { offer } = await storeWithOffer(ctx, { partyMax: 2 });
          return { offerId: offer.id, party: 3 };
        },
        kind: "party_over_max",
        partyMax: 2,
      },
    ];
    for (const cs of cases) {
      ctx.clock.set("2026-09-22T06:00:00.000Z");
      const { offerId, party } = await cs.make();
      const f = await fetchOffers(c.api, { party });
      const before = (await rows(ctx.db, "SELECT id FROM reservations")).length;
      const r = await receive(c.api, { offerId, party, fetchId: f.json.fetchId });
      expect(r.status, cs.name).toBe(409);
      expect(r.json.ok, cs.name).toBe(false);
      expect(r.json.refusal.kind, cs.name).toBe(cs.kind);
      if (cs.partyMax) expect(r.json.refusal.partyMax, cs.name).toBe(cs.partyMax);
      else expect(r.json.refusal.partyMax, cs.name).toBeUndefined();
      expect(["search_again", "search_again_with_party", "back_to_reservation", "retry_same_party"], cs.name).toContain(r.json.refusal.nextStep);
      expect(r.json.home.kind, cs.name).toBe("fetch");
      expect((await rows(ctx.db, "SELECT id FROM reservations")).length, cs.name).toBe(before);
    }
    ctx.clock.set("2026-09-22T06:00:00.000Z");
  });

  it("8.8・8.9 確保中の確保があると has_active_reservation で作られない（今の確保が home に載る）。期限切れだけなら作れる", async () => {
    const { offer } = await storeWithOffer(ctx, { capacity: 5 });
    const c = await customer(ctx);
    const f = await fetchOffers(c.api, { party: 2 });
    const first = await receive(c.api, { offerId: offer.id, party: 2, fetchId: f.json.fetchId });
    expect(first.status).toBe(200);
    const again = await receive(c.api, { offerId: offer.id, party: 2, fetchId: f.json.fetchId });
    expect(again.status).toBe(409);
    expect(again.json.refusal.kind).toBe("has_active_reservation");
    expect(again.json.refusal.nextStep).toBe("back_to_reservation");
    expect(again.json.home.kind).toBe("active");
    expect(again.json.home.reservation.id).toBe(first.json.reservation.id);
    expect((await rows(ctx.db, "SELECT id FROM reservations WHERE customer_id = (SELECT customer_id FROM reservations WHERE id = ?)", first.json.reservation.id)).length).toBe(1);
    ctx.clock.set(new Date(ctx.clock.now().getTime() + 21 * MIN).toISOString());
    const second = await receive(c.api, { offerId: offer.id, party: 2, fetchId: f.json.fetchId });
    expect(second.status).toBe(200);
    expect(second.json.reservation.id).not.toBe(first.json.reservation.id);
    ctx.clock.set("2026-09-22T06:00:00.000Z");
  });

  it("8.7 残り1へ10人が同時に受け取り、確保は1件・残りは0。18.12 残り0は取得の結果に出ず受け取れない", async () => {
    const { store, offer } = await storeWithOffer(ctx, { capacity: 1 });
    const people = await Promise.all(Array.from({ length: 10 }, () => customer(ctx)));
    const fetches = await Promise.all(people.map((p) => fetchOffers(p.api, { party: 2 })));
    const results = await Promise.all(people.map((p, i) => receive(p.api, { offerId: offer.id, party: 2, fetchId: fetches[i].json.fetchId })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409 && r.json.refusal.kind === "sold_out")).toHaveLength(9);
    expect((await rows(ctx.db, "SELECT id FROM reservations WHERE offer_id = ? AND status = 'active'", offer.id)).length).toBe(1);
    expect((await store.api.get("/api/store/home")).json.offer.remaining).toBe(0);
    const loser = people[results.findIndex((r) => r.status !== 200)];
    const f = await fetchOffers(loser.api, { party: 2 });
    expect(f.json.items.map((i: any) => i.offerId)).not.toContain(offer.id);
    expect((await receive(loser.api, { offerId: offer.id, party: 2, fetchId: f.json.fetchId })).json.refusal.kind).toBe("sold_out");
  });

  it("18.10 公開の直後の残りは募集する組数と同じ。18.13 期限切れで残りが1以上に戻ると、また受け取れる", async () => {
    const { store, offer } = await storeWithOffer(ctx, { capacity: 1 });
    expect((await store.api.get("/api/store/home")).json.offer).toMatchObject({ capacity: 1, remaining: 1 });
    const a = await customer(ctx);
    const fa = await fetchOffers(a.api, { party: 2 });
    expect((await receive(a.api, { offerId: offer.id, party: 2, fetchId: fa.json.fetchId })).status).toBe(200);
    expect((await store.api.get("/api/store/home")).json.offer.remaining).toBe(0);
    ctx.clock.set(new Date(ctx.clock.now().getTime() + 20 * MIN).toISOString());
    expect((await store.api.get("/api/store/home")).json.offer.remaining).toBe(1);
    const b = await customer(ctx);
    const fb = await fetchOffers(b.api, { party: 2 });
    expect(fb.json.items.map((i: any) => i.offerId)).toContain(offer.id);
    expect((await receive(b.api, { offerId: offer.id, party: 2, fetchId: fb.json.fetchId })).status).toBe(200);
    ctx.clock.set("2026-09-22T06:00:00.000Z");
  });

  it("8.6 nextStep の表（純粋）: 5種の理由 × ホームの状態", async () => {
    const { nextStep } = await loadWeb("lib/domain/receiveRefusal");
    const fetch = { kind: "fetch" };
    const retryable = { kind: "expired", expired: { showCode: true, canRetry: true } };
    const notRetryable = { kind: "expired", expired: { showCode: true, canRetry: false } };
    expect(nextStep("has_active_reservation", { kind: "active" })).toBe("back_to_reservation");
    expect(nextStep("party_over_max", fetch)).toBe("search_again_with_party");
    expect(nextStep("party_over_max", notRetryable)).toBe("search_again_with_party");
    for (const kind of ["sold_out", "offer_ended", "store_banned"]) {
      expect(nextStep(kind, fetch), kind).toBe("search_again");
      expect(nextStep(kind, notRetryable), kind).toBe("search_again");
      expect(nextStep(kind, retryable), kind).toBe("retry_same_party");
    }
  });

  it("9.1・9.2・9.13 客のホーム（確保中）: コード・店名・住所・人数・期限・クーポン、URL の有無、クーポン0個は空", async () => {
    const active = await receivedScene(ctx, { coupons: [{ name: "生ビール", note: "1組1回" }] });
    const home = (await active.customer.api.get("/api/customer/home")).json;
    expect(home.kind).toBe("active");
    expect(home.reservation).toMatchObject({ code: active.reservation.code, storeName: "受け取りの店", party: 2, coupons: [{ name: "生ビール", note: "1組1回" }] });
    expect(home.reservation.storeAddress).toBeTruthy();
    expect(home.reservation.storeUrl).toMatch(/^https:/);
    expect(home.reservation.expiresAt).toBeTruthy();
    const noCoupon = await receivedScene(ctx);
    expect((await noCoupon.customer.api.get("/api/customer/home")).json.reservation.coupons).toEqual([]);
  });
});

describeTask("15", "客が取り消したあとの受け取り（8.9）と、取り消しで残りが戻る（18.13）・状態の記録（27.4）・ホーム（9.5）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("8.9・9.5・18.13・27.4 取り消したあとはまた受け取れ、ホームは取得の画面、残りが戻り、記録が1件足される", async () => {
    const s = await receivedScene(ctx, { capacity: 1 });
    const before = (await rows(ctx.db, "SELECT id FROM reservation_events WHERE reservation_id = ?", s.reservation.id)).length;
    expect((await s.customer.api.post(`/api/customer/reservations/${s.reservation.id}/cancel`, {})).status).toBe(200);
    expect((await s.customer.api.get("/api/customer/home")).json.kind).toBe("fetch");
    const events = await rows(ctx.db, "SELECT status FROM reservation_events WHERE reservation_id = ? ORDER BY rowid", s.reservation.id);
    expect(events.length).toBe(before + 1);
    expect(events.at(-1)!.status).toBe("customer_cancelled");
    expect((await s.store.api.get("/api/store/home")).json.offer.remaining).toBe(1);
    const f = await fetchOffers(s.customer.api, { party: 2 });
    expect(f.json.items.map((i: any) => i.offerId)).toContain(s.offer.id);
    const again = await receive(s.customer.api, { offerId: s.offer.id, party: 2, fetchId: f.json.fetchId });
    expect(again.status).toBe(200);
    expect(again.json.reservation.code).not.toBe(s.reservation.code);
  });
});

describeTask("17", "完了済みのあとの受け取り（8.9）と、完了済みのホーム（9.3・9.4）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("8.9・9.3・9.4 完了済みになると客のホームは完了済み（3時間の内）、そのあと取得の画面。完了済みだけなら受け取れる", async () => {
    ctx.clock.set("2026-09-22T06:00:00.000Z");
    const s = await receivedScene(ctx, { capacity: 5 });
    expect((await s.store.api.post(`/api/store/reservations/${s.reservation.id}/complete`, {})).status).toBe(200);
    let home = (await s.customer.api.get("/api/customer/home")).json;
    expect(home.kind).toBe("completed");
    expect(home.reservation.status).toBe("completed");
    const f = await fetchOffers(s.customer.api, { party: 2 });
    const again = await receive(s.customer.api, { offerId: s.offer.id, party: 2, fetchId: f.json.fetchId });
    expect(again.status).toBe(200);
    const t = await receivedScene(ctx, { capacity: 5 });
    await t.store.api.post(`/api/store/reservations/${t.reservation.id}/complete`, {});
    ctx.clock.set("2026-09-22T09:01:00.000Z");
    home = (await t.customer.api.get("/api/customer/home")).json;
    expect(home.kind).toBe("fetch");
    ctx.clock.set("2026-09-22T06:00:00.000Z");
  });
});

describeTask("18", "店が取り消したあとの客のホーム（9.6）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("9.6 店が取り消すと、店の都合で取り消されたことの表示（store_cancelled）になり、取得し直せる", async () => {
    const s = await receivedScene(ctx);
    await s.store.api.post(`/api/store/reservations/${s.reservation.id}/cancel`, {});
    const home = (await s.customer.api.get("/api/customer/home")).json;
    expect(home.kind).toBe("store_cancelled");
    expect(home.reservation.status).toBe("store_cancelled");
    const f = await fetchOffers(s.customer.api, { party: 2 });
    expect(f.status).toBe(200);
  });
});

describeTask("21", "運営が止めたあとの客のホーム（9.7）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("9.7 運営が店を止めると、運営が停止したために取り消されたことの表示（admin_cancelled）になる", async () => {
    const s = await receivedScene(ctx);
    await ctx.admin!.api.post(`/api/admin/stores/${s.store.id}/ban`, {});
    const home = (await s.customer.api.get("/api/customer/home")).json;
    expect(home.kind).toBe("admin_cancelled");
    expect(home.reservation.status).toBe("admin_cancelled");
  });
});

describeTask("30", "【最終日】過去の受け取りの一覧（8.11）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("8.11 店名・コード・状態・住所・URL が新しい順に出て、別の客のものは出ない", async () => {
    const a = await receivedScene(ctx, { storeName: "一軒目" });
    await a.customer.api.post(`/api/customer/reservations/${a.reservation.id}/cancel`, {});
    const s2 = await approvedStore(ctx, { name: "二軒目", address: "二軒目の住所", url: null });
    const o2 = await publishOffer(s2.api);
    ctx.clock.set(new Date(ctx.clock.now().getTime() + MIN).toISOString());
    const f = await fetchOffers(a.customer.api, { party: 2 });
    const r2 = await receive(a.customer.api, { offerId: o2.id, party: 2, fetchId: f.json.fetchId });
    expect(r2.status).toBe(200);
    const other = await receivedScene(ctx, { storeName: "他人の店" });
    const h = await a.customer.api.get("/api/customer/history");
    expect(h.status).toBe(200);
    expect(h.json.items.map((i: any) => i.storeName)).toEqual(["二軒目", "一軒目"]);
    expect(h.json.items[0]).toMatchObject({ code: r2.json.reservation.code, status: "active", storeAddress: "二軒目の住所", storeUrl: null });
    expect(h.json.items[1]).toMatchObject({ code: a.reservation.code, status: "customer_cancelled" });
    expect(h.text).not.toContain(other.reservation.code);
  });
});
