// 要件24 運営の管理画面（店の一覧・絞り込み・検索・集計）（手続き）。画面は r24-admin.ui.test.tsx。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { approvedStore, makeCtx, PDF_BYTES, publishOffer, receivedScene, registerStore, seedAdmin, uploadLicense, type Ctx } from "./_fakes";

describeTask("8", "店の一覧・絞り込み・検索・集計・詳細", () => {
  let ctx: Ctx;
  let ids: Record<string, string> = {};
  beforeAll(async () => {
    ctx = await makeCtx();
    await seedAdmin(ctx);
    const pending = await registerStore(ctx, { name: "未承認の店", email: "pending-store@example.com" });
    const approved = await approvedStore(ctx, { name: "承認済みの店", email: "approved-store@example.com", address: "東京都港区赤坂1-1" });
    const publishing = await approvedStore(ctx, { name: "公開中の店", email: "publishing@example.com", address: "東京都中野区中野2-2" });
    await publishOffer(publishing.api, { capacity: 1 });
    await approvedStore(ctx, { name: "公開していない店", email: "idle@example.com", address: "東京都杉並区3-3" });
    const scene = await receivedScene(ctx, { capacity: 1, storeName: "受け取りの店" });
    const banned = await approvedStore(ctx, { name: "止められた店", email: "banned@example.com" });
    await ctx.admin!.api.post(`/api/admin/stores/${banned.id}/ban`, {});
    ids = { pending: pending.id, approved: approved.id, publishing: publishing.id, banned: banned.id, scene: scene.store.id };
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  const list = async (q = "") => (await ctx.admin!.api.get(`/api/admin/stores${q}`)).json;

  it("24.1・24.2 一覧に店ごとの店名・住所・メールアドレス・承認の状況が出る", async () => {
    const j = await list();
    expect(j.items.length).toBeGreaterThanOrEqual(5);
    const pending = j.items.find((s: any) => s.id === ids.pending);
    expect(pending).toMatchObject({ name: "未承認の店", email: "pending-store@example.com", status: "pending" });
    expect(j.items.find((s: any) => s.id === ids.approved)).toMatchObject({ address: "東京都港区赤坂1-1", status: "approved" });
    expect(j.items.find((s: any) => s.id === ids.banned).status).toBe("banned");
  });

  it("24.3・24.4 4つの絞り込み。「オファー公開中」は残り0も含む（scene の店は capacity 1 を受け取られて残り0）", async () => {
    const publishing = (await list("?filter=publishing")).items.map((s: any) => s.id).sort();
    expect(publishing).toEqual([ids.publishing, ids.scene].sort());
    const approved = (await list("?filter=approved")).items.map((s: any) => s.id);
    expect(approved).toContain(ids.approved);
    expect(approved).not.toContain(ids.pending);
    expect(approved).not.toContain(ids.banned);
    expect((await list("?filter=pending")).items.map((s: any) => s.id)).toEqual([ids.pending]);
    expect((await list("?filter=banned")).items.map((s: any) => s.id)).toEqual([ids.banned]);
  });

  it("24.5・24.6 店名・住所・メールアドレスの部分一致。絞り込みと検索の重ね掛け", async () => {
    expect((await list("?q=承認済み")).items.map((s: any) => s.id)).toEqual([ids.approved]);
    expect((await list("?q=赤坂")).items.map((s: any) => s.id)).toEqual([ids.approved]);
    expect((await list("?q=publishing%40")).items.map((s: any) => s.id)).toEqual([ids.publishing]);
    expect((await list(`?q=${encodeURIComponent("店")}`)).items.length).toBeGreaterThanOrEqual(5);
    expect((await list(`?q=${encodeURIComponent("店")}&filter=banned`)).items.map((s: any) => s.id)).toEqual([ids.banned]);
    expect((await list("?q=zzz-nothing")).items).toEqual([]);
  });

  it("24.8・24.9 いちばん上の集計: 公開中のオファーの数（残り0を含む）と未承認の数", async () => {
    const j = await list();
    expect(j.summary.publishing).toBe(2);
    expect(j.summary.pending).toBe(1);
    await registerStore(ctx, { name: "もう1つ未承認" });
    expect((await list()).summary.pending).toBe(2);
  });

  it("24.10・24.11 詳細に店の情報・おすすめメニュー・予算の幅が出て、営業許可書が開ける", async () => {
    const d = await ctx.admin!.api.get(`/api/admin/stores/${ids.approved}`);
    expect(d.status).toBe(200);
    expect(d.json.store).toMatchObject({ name: "承認済みの店", address: "東京都港区赤坂1-1", menus: ["刺身盛り", "焼き魚定食"], budgetMin: 2000, budgetMax: 4000, license: true, cardRegistered: true, status: "approved" });
    const lic = await ctx.admin!.api.get(`/api/admin/stores/${ids.approved}/license`);
    expect(lic.status).toBe(200);
    expect(lic.headers.get("content-type")).toBe("application/pdf");
    const s = await registerStore(ctx);
    await uploadLicense(s.api, PDF_BYTES);
    expect((await ctx.admin!.api.get(`/api/admin/stores/${s.id}/license`)).status).toBe(200);
    expect((await ctx.admin!.api.get(`/api/admin/stores/no-such-store/license`)).status).toBe(404);
  });
});
