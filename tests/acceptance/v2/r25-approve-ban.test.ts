// 要件25 承認と緊急の停止（手続き）。承認はタスク8、停止と復帰はタスク21。画面は r24-admin.ui.test.tsx。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { approvedStore, fetchOffers, makeCtx, one, PDF_BYTES, receivedScene, registerCard, registerCustomer, registerStore, seedAdmin, snapshot, uploadLicense, type Ctx } from "./_fakes";

describeTask("8", "承認", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
    await seedAdmin(ctx);
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("25.2 許可書もカードも無い／許可書だけ／カードだけ、の店は approval_missing で断り、足りないものが fields に返る。状況は未承認のまま", async () => {
    const s = await registerStore(ctx);
    let r = await ctx.admin!.api.post(`/api/admin/stores/${s.id}/approve`, {});
    expect(r.status).toBe(409);
    expect(r.json.error.kind).toBe("approval_missing");
    expect(r.json.error.fields.map((f: any) => f.name).sort()).toEqual(["card", "license"]);
    await uploadLicense(s.api, PDF_BYTES);
    r = await ctx.admin!.api.post(`/api/admin/stores/${s.id}/approve`, {});
    expect(r.json.error.fields.map((f: any) => f.name)).toEqual(["card"]);
    expect((await one(ctx.db, "SELECT status FROM stores WHERE id = ?", s.id)).status).toBe("pending");
    const t = await registerStore(ctx);
    await registerCard(t.api);
    r = await ctx.admin!.api.post(`/api/admin/stores/${t.id}/approve`, {});
    expect(r.json.error.fields.map((f: any) => f.name)).toEqual(["license"]);
  });

  it("25.1 揃った店を承認すると承認済みになり、店のホームにも映る", async () => {
    const s = await registerStore(ctx);
    await uploadLicense(s.api, PDF_BYTES);
    await registerCard(s.api);
    const r = await ctx.admin!.api.post(`/api/admin/stores/${s.id}/approve`, {});
    expect(r.status).toBe(200);
    expect((await one(ctx.db, "SELECT status FROM stores WHERE id = ?", s.id)).status).toBe("approved");
    expect((await s.api.get("/api/store/home")).json.status).toBe("approved");
  });

  it("25.3 承認を断る入口が無い", () => {
    const paths = ctx.app.routes.map((r: any) => r.path);
    expect(paths.filter((p: string) => /admin\/stores\/:id\/(reject|deny|decline|refuse)/.test(p))).toEqual([]);
  });
});

describeTask("21", "緊急の停止と復帰", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("25.4・25.6・25.7・25.8・25.11 止めると「止められている」になり、公開中のオファーが終わり、確保中の確保が全部取り消され、コードが使えない", async () => {
    const scene = await receivedScene(ctx, { capacity: 3 });
    const second = await (async () => {
      const c = await registerCustomer(ctx, { nickname: "ふたりめ", phone: "08022223333" });
      const f = await fetchOffers(c.api, { party: 2 });
      const r = await c.api.post("/api/customer/reservations", { offerId: scene.offer.id, party: 2, fetchId: f.json.fetchId });
      expect(r.status).toBe(200);
      return { customer: c, reservation: r.json.reservation };
    })();
    const ban = await ctx.admin!.api.post(`/api/admin/stores/${scene.store.id}/ban`, {});
    expect(ban.status).toBe(200);
    expect((await one(ctx.db, "SELECT status FROM stores WHERE id = ?", scene.store.id)).status).toBe("banned");
    const offer = await one(ctx.db, "SELECT ended_at, end_reason FROM offers WHERE id = ?", scene.offer.id);
    expect(offer.ended_at).toBeTruthy();
    expect(offer.end_reason).toBe("banned");
    for (const id of [scene.reservation.id, second.reservation.id]) {
      expect((await one(ctx.db, "SELECT status FROM reservations WHERE id = ?", id)).status).toBe("admin_cancelled");
    }
    expect((await scene.customer.api.get("/api/customer/home")).json.kind).toBe("admin_cancelled");
    expect((await second.customer.api.get("/api/customer/home")).json.kind).toBe("admin_cancelled");
    const complete = await scene.store.api.post(`/api/store/reservations/${scene.reservation.id}/complete`, {});
    expect(complete.status).toBe(409);
    expect((await one(ctx.db, "SELECT status FROM reservations WHERE id = ?", scene.reservation.id)).status).toBe("admin_cancelled");
    expect((await scene.store.api.get("/api/store/home")).json.offer).toBeNull();
  });

  it("25.4 未承認の店は止められない（承認済みだけ）。止めた店をもう一度止めても変わらない", async () => {
    const pending = await registerStore(ctx);
    const r = await ctx.admin!.api.post(`/api/admin/stores/${pending.id}/ban`, {});
    expect(r.status).toBe(409);
    expect((await one(ctx.db, "SELECT status FROM stores WHERE id = ?", pending.id)).status).toBe("pending");
  });

  it("25.9・25.10 止められている店を承認済みに戻せる。戻しても終わったオファーと取り消された確保は戻らない", async () => {
    const scene = await receivedScene(ctx);
    await ctx.admin!.api.post(`/api/admin/stores/${scene.store.id}/ban`, {});
    const before = await snapshot(ctx.db);
    const restore = await ctx.admin!.api.post(`/api/admin/stores/${scene.store.id}/restore`, {});
    expect(restore.status).toBe(200);
    expect((await one(ctx.db, "SELECT status FROM stores WHERE id = ?", scene.store.id)).status).toBe("approved");
    expect((await one(ctx.db, "SELECT ended_at FROM offers WHERE id = ?", scene.offer.id)).ended_at).toBeTruthy();
    expect((await one(ctx.db, "SELECT status FROM reservations WHERE id = ?", scene.reservation.id)).status).toBe("admin_cancelled");
    expect((await scene.store.api.get("/api/store/home")).json.status).toBe("approved");
    expect(before).not.toBe(await snapshot(ctx.db));
    const s2 = await approvedStore(ctx);
    expect((await ctx.admin!.api.post(`/api/admin/stores/${s2.id}/restore`, {})).status).toBe(409);
  });

  it("25.7 止めたあと、その店は公開できず、取得の結果にも出ない", async () => {
    const scene = await receivedScene(ctx);
    await ctx.admin!.api.post(`/api/admin/stores/${scene.store.id}/ban`, {});
    const pub = await scene.store.api.post("/api/store/offers", { couponIds: [], capacity: 2, partyMax: 4, until: "23:00" });
    expect(pub.status).toBe(409);
    const other = await registerCustomer(ctx, { nickname: "さがすひと", phone: "08044445555" });
    const f = await fetchOffers(other.api, { party: 2 });
    expect(f.status).toBe(200);
    expect(f.json.items.map((i: any) => i.storeId)).not.toContain(scene.store.id);
  });

  it("停止と復帰は運営の入口だけ（店のセッションでは 403）", async () => {
    const s = await approvedStore(ctx);
    expect((await s.api.post(`/api/admin/stores/${s.id}/ban`, {})).status).toBe(403);
  });
});
