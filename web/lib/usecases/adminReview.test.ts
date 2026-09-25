// 運営の判断材料（2026-09-25 監査の指摘 運営-03・運営-05・運営-07・運営-09・運営-11・横断-09）。
//
// 止める前に「今何組が向かっているか・その店への通報」が見えず、差し戻した店が承認待ちに積もり、
// ジャンルで絞れず、同じ客の連打も店の取り消しの回数も見分けられなかった。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvedStore, makeCtx, MIN, one, PDF_BYTES, PNG_BYTES, receivedScene, registerStore, rows, seedAdmin, uploadLicense, type Ctx } from "../../../tests/acceptance/v2/_fakes";

let ctx: Ctx;

beforeAll(async () => {
  ctx = await makeCtx();
  await seedAdmin(ctx);
});

afterAll(async () => {
  await ctx.dispose();
});

const detailOf = async (storeId: string) => (await ctx.admin!.api.get(`/api/admin/stores/${storeId}`)).json;
const listOf = async (query = "") => (await ctx.admin!.api.get(`/api/admin/stores${query}`)).json;

describe("止める前に見るもの（運営-03）", () => {
  it("詳細に、今向かっている組数と、その店への通報（件数・直近の3件）が出る", async () => {
    const scene = await receivedScene(ctx, { storeName: "向かわれている店" });
    for (const reason of ["1件目", "2件目", "3件目", "4件目"]) {
      ctx.clock.set(new Date(ctx.clock.now().getTime() + MIN).toISOString());
      expect([200, 201]).toContain((await scene.customer.api.post("/api/customer/reports", { storeId: scene.store.id, reason })).status);
    }
    const detail = await detailOf(scene.store.id);
    expect(detail.store.activeReservations).toBe(1);
    expect(detail.store.publishing).toBe(true);
    expect(detail.reports.count).toBe(4);
    expect(detail.reports.latest.map((r: { reason: string }) => r.reason)).toEqual(["4件目", "3件目", "2件目"]);
    // 同じ客の通報は同じ印（運営-09）。客の番号そのものは出さない
    expect(new Set(detail.reports.latest.map((r: { reporter: string }) => r.reporter)).size).toBe(1);
    const customerId = (await one(ctx.db, "SELECT customer_id FROM reports WHERE store_id = ? LIMIT 1", scene.store.id)).customer_id as string;
    expect(JSON.stringify(detail)).not.toContain(customerId);
  });
});

describe("承認待ちの手がかり（運営-05）", () => {
  it("詳細に登録日時・許可書を上げた日時・同じ店名か住所の登録の数が出る", async () => {
    const first = await approvedStore(ctx, { name: "同じ名前の店" });
    const second = await registerStore(ctx, { name: "同じ名前の店" });
    await uploadLicense(second.api, PDF_BYTES);
    const detail = await detailOf(second.id);
    expect(detail.store.createdAt).toBeTruthy();
    expect(detail.store.licenseUploadedAt).toBe(ctx.clock.now().toISOString());
    expect(detail.store.duplicates).toBeGreaterThanOrEqual(1);
    expect((await detailOf(first.id)).store.duplicates).toBeGreaterThanOrEqual(1);
  });

  it("「連絡済み」にした未承認の店は承認待ちの数から外れ、そのあと許可書が上げ直されるとまた数える。メモと印は記録に残る", async () => {
    const store = await registerStore(ctx, { name: "差し戻した店" });
    await uploadLicense(store.api, PDF_BYTES);
    const before = (await listOf()).summary;
    expect(before.awaiting).toBe(before.pending);

    const saved = await ctx.admin!.api.post(`/api/admin/stores/${store.id}/note`, { note: "許可書の字が潰れていたので再提出を依頼", contacted: true });
    expect(saved.status).toBe(200);
    let summary = (await listOf()).summary;
    expect(summary.pending).toBe(before.pending);
    expect(summary.awaiting).toBe(before.awaiting - 1);
    const detail = await detailOf(store.id);
    expect(detail.store).toMatchObject({ note: "許可書の字が潰れていたので再提出を依頼", contacted: true, contactedAt: ctx.clock.now().toISOString() });
    expect(detail.history[0]).toMatchObject({ action: "note", reason: "許可書の字が潰れていたので再提出を依頼", detail: { contacted: true } });
    expect((await listOf("?filter=pending")).items.find((s: { id: string }) => s.id === store.id).contacted).toBe(true);

    ctx.clock.set(new Date(ctx.clock.now().getTime() + MIN).toISOString());
    await uploadLicense(store.api, PNG_BYTES, "again.png", "image/png");
    summary = (await listOf()).summary;
    expect(summary.awaiting).toBe(before.awaiting);
    expect((await detailOf(store.id)).store.contacted).toBe(false);
  });

  it("メモの長さの上限を超えると 400、無い店は 404", async () => {
    const store = await registerStore(ctx, { name: "長いメモの店" });
    const long = await ctx.admin!.api.post(`/api/admin/stores/${store.id}/note`, { note: "あ".repeat(1001), contacted: false });
    expect(long.status).toBe(400);
    expect((await ctx.admin!.api.post("/api/admin/stores/no-such-store/note", { note: "", contacted: false })).status).toBe(404);
    expect((await ctx.admin!.api.post("/api/admin/stores/no-such-store/acknowledge", {})).status).toBe(404);
    expect(await rows(ctx.db, "SELECT id FROM admin_actions WHERE store_id = ?", store.id)).toEqual([]);
  });
});

describe("ジャンルの絞り込みと全店の数（運営-07・運営-11）", () => {
  it("?genre= で、その店のジャンルに含まれる店だけが出る。状態の絞り込み・検索と重ねて効く。知らないジャンルは 400", async () => {
    const ramen = await approvedStore(ctx, { name: "ラーメンの店", genres: ["ラーメン"] });
    const washoku = await approvedStore(ctx, { name: "和食の店", genres: ["和食"] });
    const ids = (await listOf(`?genre=${encodeURIComponent("ラーメン")}`)).items.map((s: { id: string }) => s.id);
    expect(ids).toContain(ramen.id);
    expect(ids).not.toContain(washoku.id);
    expect((await listOf(`?genre=${encodeURIComponent("ラーメン")}&filter=pending`)).items.map((s: { id: string }) => s.id)).not.toContain(ramen.id);
    expect((await listOf(`?genre=${encodeURIComponent("ラーメン")}&q=${encodeURIComponent("和食")}`)).items).toEqual([]);
    expect((await ctx.admin!.api.get(`/api/admin/stores?genre=${encodeURIComponent("宇宙食")}`)).status).toBe(400);
  });

  it("集計の total は絞り込みに左右されない全店の数", async () => {
    const all = await listOf();
    const pendingOnly = await listOf("?filter=pending");
    expect(all.summary.total).toBe(all.items.length);
    expect(pendingOnly.summary.total).toBe(all.items.length);
    expect(pendingOnly.items.length).toBeLessThan(all.items.length);
  });
});

describe("店に取り消された客の通報と、店の取り消しの回数（横断-09）", () => {
  it("店に確保を取り消された客は、7日間はその店を通報できる。運営の一覧と詳細に店の取り消しの回数と割合が出る", async () => {
    const scene = await receivedScene(ctx, { storeName: "取り消す店" });
    const cancel = await scene.store.api.post(`/api/store/reservations/${scene.reservation.id}/cancel`, {});
    expect(cancel.status).toBe(200);
    const report = await scene.customer.api.post("/api/customer/reports", { storeId: scene.store.id, reason: "着く直前に取り消された" });
    expect([200, 201]).toContain(report.status);

    const row = (await listOf()).items.find((s: { id: string }) => s.id === scene.store.id);
    expect(row).toMatchObject({ storeCancelled: 1, storeCancelRate: 1 });
    expect((await detailOf(scene.store.id)).store).toMatchObject({ storeCancelled: 1, storeCancelRate: 1 });

    const cancelledAt = ctx.clock.now().toISOString();
    ctx.clock.set(new Date(ctx.clock.now().getTime() + 8 * 24 * 60 * MIN).toISOString());
    const late = await scene.customer.api.post("/api/customer/reports", { storeId: scene.store.id, reason: "8日後" });
    expect(late.status).toBe(409);
    expect(late.json.error.kind).toBe("report_not_allowed");
    // 運営のセッション（25時間）が切れないよう、時計を戻す
    ctx.clock.set(cancelledAt);
  });
});

describe("通報の一覧の判断材料（運営-09）", () => {
  it("行ごとに、通報した客の短い印とその店への通報の数が出る。別の客は別の印", async () => {
    const a = await receivedScene(ctx, { storeName: "通報の多い店" });
    await a.customer.api.post("/api/customer/reports", { storeId: a.store.id, reason: "客Aの1件目" });
    await a.customer.api.post("/api/customer/reports", { storeId: a.store.id, reason: "客Aの2件目" });
    const b = await receivedScene(ctx, { storeName: "別の店" });
    await b.customer.api.post("/api/customer/reports", { storeId: b.store.id, reason: "客Bの1件目" });
    const items = (await ctx.admin!.api.get("/api/admin/reports")).json.items as Array<{ reason: string; reporter: string; storeReportCount: number }>;
    const byReason = (reason: string) => items.find((i) => i.reason === reason)!;
    expect(byReason("客Aの1件目").reporter).toMatch(/^[0-9a-f]{6}$/);
    expect(byReason("客Aの1件目").reporter).toBe(byReason("客Aの2件目").reporter);
    expect(byReason("客Bの1件目").reporter).not.toBe(byReason("客Aの1件目").reporter);
    expect(byReason("客Aの1件目").storeReportCount).toBe(2);
    expect(byReason("客Bの1件目").storeReportCount).toBe(1);
  });
});
