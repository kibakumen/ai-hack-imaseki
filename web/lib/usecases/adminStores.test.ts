// 運営の店の一覧・詳細・承認・停止（要件24の基準 24.1〜24.11／要件25の基準 25.1・25.2・25.3・25.6・25.7）。
//
// ⚠️ なぜ受け入れ検査とは別にこれを置くか: 受け入れ検査（r24-admin-list・r25-approve-ban）は場面の
// 準備に店の情報（タスク5）・クーポン（6）・営業許可書とカード（7）の入口を使うので、それらが
// 揃うまで1件も回せない。ここでは D1 に直に種を入れて、タスク8の持ち場だけを先に確かめる。
// 受け入れ検査が通るようになったら、重なる分はここから落としてよい（2026-09-21 実行者）。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeCtx, registerStore, seedAdmin, T0, type Api, type Ctx } from "../../../tests/acceptance/v2/_fakes";

const HOUR = 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(new Date(T0).getTime() + offsetMs).toISOString();

let ctx: Ctx;
let admin: Api;
const ids: Record<string, string> = {};

/** 店を1つ作り、タスク5・7が入れるはずの列（住所・メニュー・予算・許可書・カード）を直に埋める。 */
const seedStore = async (input: { key: string; name: string; email: string; address?: string; license?: boolean; card?: boolean }) => {
  const store = await registerStore(ctx, { name: input.name, email: input.email });
  await ctx.db
    .prepare(`UPDATE stores SET address = ?2, genres = ?3, menus = ?4, budget_min = ?5, budget_max = ?6, license_key = ?7, card_registered_at = ?8 WHERE id = ?1`)
    .bind(
      store.id,
      input.address ?? null,
      JSON.stringify(["和食"]),
      JSON.stringify(["刺身盛り", "焼き魚定食"]),
      2000,
      4000,
      input.license === false ? null : `permits/${store.id}.pdf`,
      input.card === false ? null : T0,
    )
    .run();
  ids[input.key] = store.id;
  return store;
};

/** オファーを1つ入れる（公開はタスク9の持ち場なので、ここでは表へ直に入れる）。 */
const seedOffer = async (storeId: string, over: { capacity?: number; untilAt?: string; endedAt?: string | null } = {}) => {
  await ctx.db
    .prepare(`INSERT INTO offers (id, store_id, capacity, initial_capacity, party_max, published_at, until_at, ended_at, end_reason) VALUES (?1, ?2, ?3, ?3, 4, ?4, ?5, ?6, ?7)`)
    .bind(`offer-${storeId}`, storeId, over.capacity ?? 3, T0, over.untilAt ?? at(2 * HOUR), over.endedAt ?? null, over.endedAt ? "stopped" : null)
    .run();
};

const approvedStoreWithSeed = async (input: { key: string; name: string; email: string; address?: string }) => {
  const store = await seedStore(input);
  const approved = await admin.post(`/api/admin/stores/${store.id}/approve`, {});
  expect(approved.status, `承認に失敗: ${approved.text}`).toBe(200);
  return store;
};

const list = async (query = "") => (await admin.get(`/api/admin/stores${query}`)).json;

beforeAll(async () => {
  ctx = await makeCtx();
  admin = (await seedAdmin(ctx)).api;
  await seedStore({ key: "pending", name: "未承認の店", email: "pending-store@example.com", license: false, card: false });
  await approvedStoreWithSeed({ key: "approved", name: "承認済みの店", email: "approved-store@example.com", address: "東京都港区赤坂1-1" });
  await approvedStoreWithSeed({ key: "publishing", name: "公開中の店", email: "publishing@example.com", address: "東京都中野区中野2-2" });
  await seedOffer(ids.publishing);
  await approvedStoreWithSeed({ key: "soldOut", name: "残り0の店", email: "sold-out@example.com", address: "東京都杉並区3-3" });
  await seedOffer(ids.soldOut, { capacity: 0 });
  await approvedStoreWithSeed({ key: "ended", name: "終わった店", email: "ended@example.com" });
  await seedOffer(ids.ended, { endedAt: at(-HOUR) });
  await approvedStoreWithSeed({ key: "expired", name: "時間切れの店", email: "expired@example.com" });
  await seedOffer(ids.expired, { untilAt: at(-HOUR) });
  await approvedStoreWithSeed({ key: "banned", name: "止められた店", email: "banned@example.com" });
  expect((await admin.post(`/api/admin/stores/${ids.banned}/ban`, {})).status).toBe(200);
});

afterAll(async () => {
  await ctx.dispose();
});

describe("運営の店の一覧（要件24）", () => {
  it("24.1・24.2 店ごとに店名・住所・メールアドレス・承認の状況が出る", async () => {
    const json = await list();
    const idsInList = json.items.map((s: { id: string }) => s.id);
    expect(idsInList).toEqual(Object.values(ids));
    expect(json.items.find((s: { id: string }) => s.id === ids.pending)).toMatchObject({
      name: "未承認の店",
      email: "pending-store@example.com",
      status: "pending",
    });
    expect(json.items.find((s: { id: string }) => s.id === ids.approved)).toMatchObject({ address: "東京都港区赤坂1-1", status: "approved" });
    expect(json.items.find((s: { id: string }) => s.id === ids.banned).status).toBe("banned");
  });

  it("24.3・24.4 4つの絞り込み。「オファー公開中」は残り0を含み、終わった・時間の過ぎたオファーは入らない", async () => {
    const publishing = (await list("?filter=publishing")).items.map((s: { id: string }) => s.id).sort();
    expect(publishing).toEqual([ids.publishing, ids.soldOut].sort());
    const approved = (await list("?filter=approved")).items.map((s: { id: string }) => s.id);
    expect(approved).toContain(ids.approved);
    expect(approved).not.toContain(ids.pending);
    expect(approved).not.toContain(ids.banned);
    expect((await list("?filter=pending")).items.map((s: { id: string }) => s.id)).toEqual([ids.pending]);
    expect((await list("?filter=banned")).items.map((s: { id: string }) => s.id)).toEqual([ids.banned]);
  });

  it("24.5・24.6 店名・住所・メールアドレスの部分一致。絞り込みと検索の重ね掛け。当たらなければ空", async () => {
    expect((await list("?q=公開中")).items.map((s: { id: string }) => s.id)).toEqual([ids.publishing]);
    expect((await list("?q=赤坂")).items.map((s: { id: string }) => s.id)).toEqual([ids.approved]);
    expect((await list("?q=sold-out%40")).items.map((s: { id: string }) => s.id)).toEqual([ids.soldOut]);
    expect((await list(`?q=${encodeURIComponent("の店")}`)).items.length).toBeGreaterThanOrEqual(5);
    // 重ね掛けは「かつ」——検索に当たっても、絞り込みから外れる店は出ない。
    expect((await list(`?q=${encodeURIComponent("止められた")}&filter=banned`)).items.map((s: { id: string }) => s.id)).toEqual([ids.banned]);
    expect((await list(`?q=${encodeURIComponent("止められた")}&filter=approved`)).items).toEqual([]);
    expect((await list("?q=zzz-nothing")).items).toEqual([]);
  });

  it("検索の語に入った % と _ は、その字として探す（何にでも当たる印にならない）", async () => {
    expect((await list("?q=%25")).items).toEqual([]);
    expect((await list("?q=_")).items).toEqual([]);
  });

  it("空の filter と q は「指定なし」として扱い、知らない filter は断る", async () => {
    expect((await list("?filter=&q=")).items.length).toBe(Object.keys(ids).length);
    const refused = await admin.get("/api/admin/stores?filter=zzz");
    expect(refused.status).toBe(400);
    expect(refused.json.error.kind).toBe("invalid_input");
    expect(refused.json.error.fields.map((f: { name: string }) => f.name)).toEqual(["filter"]);
  });

  it("24.8・24.9 いちばん上の集計は、公開中のオファーの数と未承認の店の数。絞り込みで変わらない", async () => {
    const json = await list();
    expect(json.summary).toEqual({ publishing: 2, pending: 1 });
    expect((await list("?filter=banned")).summary).toEqual({ publishing: 2, pending: 1 });
  });
});

describe("運営の店の詳細（要件24）", () => {
  it("24.10 店の情報・おすすめメニュー・予算の幅・許可書とカードの有無が出る", async () => {
    const detail = await admin.get(`/api/admin/stores/${ids.approved}`);
    expect(detail.status).toBe(200);
    expect(detail.json.store).toMatchObject({
      id: ids.approved,
      name: "承認済みの店",
      address: "東京都港区赤坂1-1",
      email: "approved-store@example.com",
      genres: ["和食"],
      menus: ["刺身盛り", "焼き魚定食"],
      budgetMin: 2000,
      budgetMax: 4000,
      license: true,
      cardRegistered: true,
      status: "approved",
    });
  });

  it("許可書もカードも無い店は license・cardRegistered が false。無い店は 404", async () => {
    const detail = await admin.get(`/api/admin/stores/${ids.pending}`);
    expect(detail.json.store).toMatchObject({ license: false, cardRegistered: false, status: "pending" });
    expect((await admin.get("/api/admin/stores/no-such-store")).status).toBe(404);
  });
});

describe("承認（要件25）", () => {
  it("25.2 許可書もカードも無い／片方だけの店は approval_missing で断り、状況は未承認のまま", async () => {
    const store = await seedStore({ key: "missingBoth", name: "両方足りない店", email: "missing-both@example.com", license: false, card: false });
    const both = await admin.post(`/api/admin/stores/${store.id}/approve`, {});
    expect(both.status).toBe(409);
    expect(both.json.error.kind).toBe("approval_missing");
    expect(both.json.error.fields.map((f: { name: string }) => f.name).sort()).toEqual(["card", "license"]);
    expect(both.json.error.fields.every((f: { reason: string }) => f.reason === "required")).toBe(true);
    expect((await ctx.db.prepare("SELECT status FROM stores WHERE id = ?1").bind(store.id).first()).status).toBe("pending");

    const noCard = await seedStore({ key: "missingCard", name: "カードだけ足りない店", email: "missing-card@example.com", card: false });
    expect((await admin.post(`/api/admin/stores/${noCard.id}/approve`, {})).json.error.fields.map((f: { name: string }) => f.name)).toEqual(["card"]);

    const noLicense = await seedStore({ key: "missingLicense", name: "許可書だけ足りない店", email: "missing-license@example.com", license: false });
    expect((await admin.post(`/api/admin/stores/${noLicense.id}/approve`, {})).json.error.fields.map((f: { name: string }) => f.name)).toEqual(["license"]);
  });

  it("25.1 揃った店を承認すると承認済みになる。もう一度承認しようとすると今の状況を返して断る", async () => {
    const store = await seedStore({ key: "toApprove", name: "承認を待つ店", email: "to-approve@example.com" });
    expect((await admin.post(`/api/admin/stores/${store.id}/approve`, {})).status).toBe(200);
    expect((await ctx.db.prepare("SELECT status FROM stores WHERE id = ?1").bind(store.id).first()).status).toBe("approved");
    const again = await admin.post(`/api/admin/stores/${store.id}/approve`, {});
    expect(again.status).toBe(409);
    expect(again.json.current.state).toBe("approved");
    expect((await admin.post("/api/admin/stores/no-such-store/approve", {})).status).toBe(404);
  });

  it("25.3 承認を断る入口が無い", () => {
    const paths = ctx.app.routes.map((r: { path: string }) => r.path);
    expect(paths.filter((p: string) => /admin\/stores\/:id\/(reject|deny|decline|refuse)/.test(p))).toEqual([]);
  });
});

describe("止める（要件25・タスク8の持ち場の分）", () => {
  it("25.6・25.7 承認済みの店を止めると「止められている」になり、公開中のオファーが終わる", async () => {
    const store = await approvedStoreWithSeed({ key: "toBan", name: "止める店", email: "to-ban@example.com" });
    await seedOffer(store.id);
    expect((await admin.post(`/api/admin/stores/${store.id}/ban`, {})).status).toBe(200);
    expect((await ctx.db.prepare("SELECT status FROM stores WHERE id = ?1").bind(store.id).first()).status).toBe("banned");
    const offer = await ctx.db.prepare("SELECT ended_at, end_reason FROM offers WHERE store_id = ?1").bind(store.id).first();
    expect(offer.ended_at).toBe(T0);
    expect(offer.end_reason).toBe("banned");
  });

  it("25.4 未承認の店と、もう止めた店は止められない（状況は変わらない）", async () => {
    const pending = await seedStore({ key: "banPending", name: "未承認のまま止めようとする店", email: "ban-pending@example.com" });
    const refused = await admin.post(`/api/admin/stores/${pending.id}/ban`, {});
    expect(refused.status).toBe(409);
    expect(refused.json.current.state).toBe("pending");
    expect((await ctx.db.prepare("SELECT status FROM stores WHERE id = ?1").bind(pending.id).first()).status).toBe("pending");
    const twice = await admin.post(`/api/admin/stores/${ids.banned}/ban`, {});
    expect(twice.status).toBe(409);
    expect((await ctx.db.prepare("SELECT status FROM stores WHERE id = ?1").bind(ids.banned).first()).status).toBe("banned");
  });

  it("運営の入口は店のセッションでは 403、ログインしていなければ 401", async () => {
    const store = await seedStore({ key: "otherStore", name: "関係ない店", email: "other-store@example.com" });
    expect((await store.api.post(`/api/admin/stores/${ids.approved}/ban`, {})).status).toBe(403);
    expect((await store.api.get("/api/admin/stores")).status).toBe(403);
    expect((await ctx.api().get("/api/admin/stores")).status).toBe(401);
  });
});
