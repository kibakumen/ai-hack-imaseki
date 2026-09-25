// 運営の強い操作の記録と再確認（2026-09-25 監査の指摘 運営-01）と、承認した時点の写し（運営-02）。
//
// 承認・取り消し・戻す・仮のパスワードの発行・許可書の閲覧に「誰が・いつ・なぜ」が残らず、
// 承認のあとに店名・住所・許可書を差し替えると、審査した許可書が消えていた。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approvedStore,
  makeCtx,
  MIN,
  one,
  PDF_BYTES,
  PNG_BYTES,
  PUSH_SUBSCRIPTION,
  receivedScene,
  registerCard,
  registerStore,
  rows,
  seedAdmin,
  uploadLicense,
  type Ctx,
} from "../../../tests/acceptance/v2/_fakes";
import { ADMIN_REASON_MAX } from "../schemas/limits";

let ctx: Ctx;
let adminId: string;

beforeAll(async () => {
  ctx = await makeCtx();
  await seedAdmin(ctx);
  adminId = (await one(ctx.db, "SELECT id FROM accounts WHERE role = 'admin'")).id as string;
});

afterAll(async () => {
  await ctx.dispose();
});

const actionsOf = (storeId: string) => rows(ctx.db, "SELECT actor_account_id, action, reason, detail, at FROM admin_actions WHERE store_id = ? ORDER BY rowid", storeId);

describe("運営の操作の記録（運営-01）", () => {
  it("承認・取り消し・戻す・許可書の閲覧が、操作した運営と時刻つきで1行ずつ残り、取り消しと戻すには理由も残る", async () => {
    const store = await approvedStore(ctx, { name: "記録の店" });
    expect((await ctx.admin!.api.get(`/api/admin/stores/${store.id}/license`)).status).toBe(200);
    expect((await ctx.admin!.api.post(`/api/admin/stores/${store.id}/ban`, { reason: "通報が3件続いたため" })).status).toBe(200);
    expect((await ctx.admin!.api.post(`/api/admin/stores/${store.id}/restore`, { reason: "店と電話で確かめた" })).status).toBe(200);

    const actions = await actionsOf(store.id);
    expect(actions.map((a) => a.action)).toEqual(["approve", "view_license", "ban", "restore"]);
    for (const a of actions) {
      expect(a.actor_account_id).toBe(adminId);
      expect(a.at).toBe(ctx.clock.now().toISOString());
    }
    expect(actions[2].reason).toBe("通報が3件続いたため");
    expect(actions[3].reason).toBe("店と電話で確かめた");
  });

  it("取り消しの記録には、取り消した確保の数と通知を送った人数が残り、応答でも返る", async () => {
    const scene = await receivedScene(ctx, { storeName: "数を残す店" });
    await scene.customer.api.post("/api/customer/push-subscription", { subscription: PUSH_SUBSCRIPTION });
    const ban = await ctx.admin!.api.post(`/api/admin/stores/${scene.store.id}/ban`, { reason: "緊急" });
    expect(ban.status).toBe(200);
    expect(ban.json).toEqual({ ok: true, cancelled: 1, notified: 1 });
    const recorded = (await actionsOf(scene.store.id)).find((a) => a.action === "ban");
    expect(JSON.parse(recorded!.detail as string)).toEqual({ cancelled: 1, notified: 1 });
  });

  it("店の詳細に、その店への操作の履歴が新しい順で出る（操作した人はメールアドレス・理由つき）", async () => {
    const store = await approvedStore(ctx, { name: "履歴の店" });
    await ctx.admin!.api.post(`/api/admin/stores/${store.id}/ban`, { reason: "いたずらの疑い" });
    const detail = await ctx.admin!.api.get(`/api/admin/stores/${store.id}`);
    expect(detail.status).toBe(200);
    expect(detail.json.history.map((h: { action: string }) => h.action)).toEqual(["ban", "approve"]);
    expect(detail.json.history[0]).toMatchObject({ actorEmail: ctx.admin!.email, reason: "いたずらの疑い" });
  });

  it("運営の記録（Logger）にも操作した人が載る（店の番号だけの1行にしない）", async () => {
    const store = await approvedStore(ctx, { name: "ログの店" });
    await ctx.admin!.api.post(`/api/admin/stores/${store.id}/ban`, { reason: "確かめ" });
    const entries = ctx.logger.entries as Array<{ event: string; id?: string; actor?: string }>;
    const ban = entries.find((e) => e.event === "ban_store" && e.id === store.id);
    expect(ban?.actor).toBe(adminId);
    const approve = entries.find((e) => e.event === "approve_store" && e.id === store.id);
    expect(approve?.actor).toBe(adminId);
  });

  it("断られた操作（未承認の店を止める・承認済みの店を戻す）は記録を残さない", async () => {
    const pending = await registerStore(ctx, { name: "断られる店" });
    expect((await ctx.admin!.api.post(`/api/admin/stores/${pending.id}/ban`, { reason: "x" })).status).toBe(409);
    expect((await ctx.admin!.api.post(`/api/admin/stores/${pending.id}/restore`, { reason: "x" })).status).toBe(409);
    expect(await actionsOf(pending.id)).toEqual([]);
  });

  it("記録は書き換えも消去もできない（追加だけの表）", async () => {
    const store = await approvedStore(ctx, { name: "消せない記録の店" });
    await expect(ctx.db.prepare("UPDATE admin_actions SET reason = 'x' WHERE store_id = ?").bind(store.id).run()).rejects.toThrow();
    await expect(ctx.db.prepare("DELETE FROM admin_actions WHERE store_id = ?").bind(store.id).run()).rejects.toThrow();
    expect(await actionsOf(store.id)).toHaveLength(1);
  });

  it("取り消しと戻すは、入口でも理由が要る。無い・空白だけなら 400 で、店の状況も記録も変わらない", async () => {
    const store = await approvedStore(ctx, { name: "理由の無い停止を断る店" });
    for (const body of [{}, { reason: "" }, { reason: "   " }]) {
      const r = await ctx.admin!.api.post(`/api/admin/stores/${store.id}/ban`, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.json.error.fields.map((f: { name: string }) => f.name)).toContain("reason");
    }
    expect((await one(ctx.db, "SELECT status FROM stores WHERE id = ?", store.id)).status).toBe("approved");
    expect((await ctx.admin!.api.post(`/api/admin/stores/${store.id}/ban`, { reason: "確かめた" })).status).toBe(200);
    expect((await ctx.admin!.api.post(`/api/admin/stores/${store.id}/restore`, {})).status).toBe(400);
    expect((await one(ctx.db, "SELECT status FROM stores WHERE id = ?", store.id)).status).toBe("banned");
    expect((await actionsOf(store.id)).map((a) => a.action)).toEqual(["approve", "ban"]);
  });

  it(`理由は ${ADMIN_REASON_MAX} 字まで。超えると 400 で、店は止まらない`, async () => {
    const store = await approvedStore(ctx, { name: "長い理由の店" });
    const r = await ctx.admin!.api.post(`/api/admin/stores/${store.id}/ban`, { reason: "あ".repeat(ADMIN_REASON_MAX + 1) });
    expect(r.status).toBe(400);
    expect(r.json.error.fields.map((f: { name: string }) => f.name)).toContain("reason");
    expect((await one(ctx.db, "SELECT status FROM stores WHERE id = ?", store.id)).status).toBe("approved");
  });
});

describe("仮のパスワードの発行の再確認（運営-01 の案3）", () => {
  it("運営自身の今のパスワードが無いと 400、違うと 403 で、店のパスワードもセッションも変わらない", async () => {
    const store = await registerStore(ctx, { name: "発行を断る店" });
    const before = await one(ctx.db, "SELECT password_hash FROM accounts WHERE store_id = ?", store.id);
    const missing = await ctx.admin!.api.post(`/api/admin/stores/${store.id}/temp-password`, {});
    expect(missing.status).toBe(400);
    const wrong = await ctx.admin!.api.post(`/api/admin/stores/${store.id}/temp-password`, { currentPassword: "not-the-admin-password" });
    expect(wrong.status).toBe(403);
    expect(wrong.json.error.kind).toBe("password_mismatch");
    expect(await one(ctx.db, "SELECT password_hash FROM accounts WHERE store_id = ?", store.id)).toEqual(before);
    expect((await store.api.get("/api/store/home")).status).toBe(200);
    expect(await actionsOf(store.id)).toEqual([]);
  });

  it("今のパスワードが合えば発行でき、発行した記録が残る（仮のパスワードの値は記録に無い）", async () => {
    const store = await registerStore(ctx, { name: "発行する店" });
    const issued = await ctx.admin!.api.post(`/api/admin/stores/${store.id}/temp-password`, { currentPassword: ctx.admin!.password });
    expect(issued.status).toBe(200);
    const actions = await actionsOf(store.id);
    expect(actions.map((a) => a.action)).toEqual(["temp_password"]);
    expect(actions[0].actor_account_id).toBe(adminId);
    expect(JSON.stringify(actions)).not.toContain(issued.json.tempPassword);
  });
});

describe("承認した時点の写し（運営-02）", () => {
  it("承認した時点の店名・住所が写しとして残り、店が変えると詳細と一覧に「承認後に変更あり」が出る。承認は保たれる", async () => {
    const store = await approvedStore(ctx, { name: "写しの店" });
    let detail = (await ctx.admin!.api.get(`/api/admin/stores/${store.id}`)).json.store;
    expect(detail.approval).toMatchObject({ name: "写しの店", address: store.profile.address, license: true });
    expect(detail.changes).toEqual({ name: false, address: false, license: false });
    expect(detail.changedSinceApproval).toBe(false);

    const renamed = { ...store.profile, name: "近所の有名店", address: "東京都新宿区西新宿2-8-1" };
    ctx.geocoder.set(renamed.address, { lat: 35.69, lng: 139.69 });
    expect((await store.api.put("/api/store/profile", renamed)).status).toBe(200);

    detail = (await ctx.admin!.api.get(`/api/admin/stores/${store.id}`)).json.store;
    expect(detail.status).toBe("approved");
    expect(detail.approval).toMatchObject({ name: "写しの店", address: store.profile.address });
    expect(detail.changes).toEqual({ name: true, address: true, license: false });
    expect(detail.changedSinceApproval).toBe(true);
    const row = (await ctx.admin!.api.get("/api/admin/stores")).json.items.find((s: { id: string }) => s.id === store.id);
    expect(row.changedSinceApproval).toBe(true);
  });

  it("承認に使った許可書は、店が上げ直しても消えず、運営は ?version=approved で開ける。許可書の差し替えも印になる", async () => {
    const store = await approvedStore(ctx, { name: "許可書を差し替える店" });
    const reviewed = (await one(ctx.db, "SELECT license_key FROM stores WHERE id = ?", store.id)).license_key as string;
    expect((await uploadLicense(store.api, PNG_BYTES, "replaced.png", "image/png")).status).toBe(200);
    expect(ctx.files.store.has(reviewed)).toBe(true);

    const current = await ctx.admin!.api.get(`/api/admin/stores/${store.id}/license`);
    expect(current.headers.get("content-type")).toBe("image/png");
    const approved = await ctx.admin!.api.get(`/api/admin/stores/${store.id}/license?version=approved`);
    expect(approved.status).toBe(200);
    expect(approved.headers.get("content-type")).toBe("application/pdf");

    const detail = (await ctx.admin!.api.get(`/api/admin/stores/${store.id}`)).json.store;
    expect(detail.changes.license).toBe(true);
    expect(detail.licenseUploadedAt).toBe(ctx.clock.now().toISOString());
  });

  it("承認の前の上げ直しは、前のファイルを消して置き換える（基準 13.4 のまま）", async () => {
    const store = await registerStore(ctx, { name: "承認前に差し替える店" });
    await uploadLicense(store.api, PDF_BYTES);
    const first = (await one(ctx.db, "SELECT license_key FROM stores WHERE id = ?", store.id)).license_key as string;
    await uploadLicense(store.api, PNG_BYTES, "again.png", "image/png");
    expect(ctx.files.store.has(first)).toBe(false);
  });

  it("写しの無い店（未承認）は ?version=approved を 404 で断る", async () => {
    const store = await registerStore(ctx, { name: "写しの無い店" });
    await uploadLicense(store.api, PDF_BYTES);
    expect((await ctx.admin!.api.get(`/api/admin/stores/${store.id}/license?version=approved`)).status).toBe(404);
  });

  it("変更を確かめると、今の値で写しを取り直して印が消え、確かめた記録が残る", async () => {
    const store = await approvedStore(ctx, { name: "確かめる店" });
    const renamed = { ...store.profile, name: "確かめる店・改" };
    await store.api.put("/api/store/profile", renamed);
    const ack = await ctx.admin!.api.post(`/api/admin/stores/${store.id}/acknowledge`, {});
    expect(ack.status).toBe(200);
    const detail = (await ctx.admin!.api.get(`/api/admin/stores/${store.id}`)).json.store;
    expect(detail.approval.name).toBe("確かめる店・改");
    expect(detail.changedSinceApproval).toBe(false);
    expect((await actionsOf(store.id)).map((a) => a.action)).toEqual(["approve", "acknowledge"]);
    const pending = await registerStore(ctx, { name: "写しの無いまま確かめる店" });
    expect((await ctx.admin!.api.post(`/api/admin/stores/${pending.id}/acknowledge`, {})).status).toBe(409);
  });
});

/** 運営が詳細で見た内容（承認と「今の内容を確かめた」に載せる・運営-02 のレビュー）。 */
const seenOf = async (storeId: string) => {
  const store = (await ctx.admin!.api.get(`/api/admin/stores/${storeId}`)).json.store;
  return { name: store.name as string, address: store.address as string | null, licenseUploadedAt: store.licenseUploadedAt as string | null };
};

/** 時計を1分進める（上げ直した許可書の時刻が、運営が見た時刻と分かれるように）。 */
const tick = () => ctx.clock.set(new Date(ctx.clock.now().getTime() + MIN).toISOString());

const keysOf = async (storeId: string) =>
  (await one(ctx.db, "SELECT license_key, approved_license_key FROM stores WHERE id = ?", storeId)) as { license_key: string | null; approved_license_key: string | null };

describe("運営が見た内容で承認する（運営-02 のレビュー）", () => {
  it("見たあとで店が許可書を上げ直していたら 409（今の状況と changed）で断り、未承認のまま。見直してから送れば、写しは今の許可書になる", async () => {
    const store = await registerStore(ctx, { name: "審査の間に差し替える店" });
    await uploadLicense(store.api, PDF_BYTES);
    await registerCard(store.api);
    const seen = await seenOf(store.id);
    tick();
    expect((await uploadLicense(store.api, PNG_BYTES, "replaced.png", "image/png")).status).toBe(200);

    const refused = await ctx.admin!.api.post(`/api/admin/stores/${store.id}/approve`, { seen });
    expect(refused.status).toBe(409);
    expect(refused.json).toEqual({ ok: false, current: { state: "pending", changed: true } });
    expect((await one(ctx.db, "SELECT status FROM stores WHERE id = ?", store.id)).status).toBe("pending");
    expect(await actionsOf(store.id)).toEqual([]);

    expect((await ctx.admin!.api.post(`/api/admin/stores/${store.id}/approve`, { seen: await seenOf(store.id) })).status).toBe(200);
    const keys = await keysOf(store.id);
    expect(keys.approved_license_key).toBe(keys.license_key);
  });

  it("見たあとで店名か住所が変わっていても断る", async () => {
    const store = await registerStore(ctx, { name: "審査の間に名前を変える店" });
    await uploadLicense(store.api, PDF_BYTES);
    await registerCard(store.api);
    const seen = await seenOf(store.id);
    const r = await ctx.admin!.api.post(`/api/admin/stores/${store.id}/approve`, { seen: { ...seen, name: "審査で見た別の名前" } });
    expect(r.status).toBe(409);
    expect(r.json.current).toEqual({ state: "pending", changed: true });
  });

  it("もう承認済みなら、見た内容に関わらず今の状況だけを返す（changed は付けない）", async () => {
    const store = await approvedStore(ctx, { name: "見た内容より先に承認された店" });
    const r = await ctx.admin!.api.post(`/api/admin/stores/${store.id}/approve`, { seen: await seenOf(store.id) });
    expect(r.status).toBe(409);
    expect(r.json).toEqual({ ok: false, current: { state: "approved" } });
  });
});

describe("変更を確かめたあとの、前の写しの許可書（運営-02 のレビュー）", () => {
  it("写しを取り直すと、前の写しだけが指していた許可書は置き場から消える", async () => {
    const store = await approvedStore(ctx, { name: "確かめで古い許可書を消す店" });
    const reviewed = (await keysOf(store.id)).license_key as string;
    tick();
    await uploadLicense(store.api, PNG_BYTES, "replaced.png", "image/png");
    const current = (await keysOf(store.id)).license_key as string;
    expect(ctx.files.store.has(reviewed)).toBe(true);

    const ack = await ctx.admin!.api.post(`/api/admin/stores/${store.id}/acknowledge`, { seen: await seenOf(store.id) });
    expect(ack.status).toBe(200);
    expect(await keysOf(store.id)).toEqual({ license_key: current, approved_license_key: current });
    expect(ctx.files.store.has(reviewed)).toBe(false);
    expect(ctx.files.store.has(current)).toBe(true);
  });

  it("許可書が変わっていない（店名だけ変わった）なら、写しの許可書は今の許可書なので消さない", async () => {
    const store = await approvedStore(ctx, { name: "名前だけ変える店" });
    await store.api.put("/api/store/profile", { ...store.profile, name: "名前だけ変える店・改" });
    const key = (await keysOf(store.id)).license_key as string;
    expect((await ctx.admin!.api.post(`/api/admin/stores/${store.id}/acknowledge`, { seen: await seenOf(store.id) })).status).toBe(200);
    expect(ctx.files.store.has(key)).toBe(true);
  });

  it("見たあとで店が許可書を上げ直していたら 409（changed）で断り、写しも置き場も変えない", async () => {
    const store = await approvedStore(ctx, { name: "確かめの間に差し替える店" });
    const reviewed = (await keysOf(store.id)).license_key as string;
    await store.api.put("/api/store/profile", { ...store.profile, name: "確かめの間に差し替える店・改" });
    const seen = await seenOf(store.id);
    tick();
    await uploadLicense(store.api, PNG_BYTES, "replaced.png", "image/png");
    const r = await ctx.admin!.api.post(`/api/admin/stores/${store.id}/acknowledge`, { seen });
    expect(r.status).toBe(409);
    expect(r.json.current).toEqual({ state: "approved", changed: true });
    expect((await keysOf(store.id)).approved_license_key).toBe(reviewed);
    expect(ctx.files.store.has(reviewed)).toBe(true);
    expect((await actionsOf(store.id)).map((a) => a.action)).toEqual(["approve"]);
  });
});
