// 店の退会（2026-09-26 本人発案・監査の指摘 安全-20 の残り。要件13の基準 13.13〜13.20）。
//
// 入口 POST /api/store/withdraw を、手元の D1（miniflare）と偽の置き場・偽のプッシュで通しで確かめる。
// 見るのは本人が決めた範囲そのもの:
//   消す … 店のアカウントとセッション・店舗情報・営業許可書（置き場のファイルと表の鍵）・クーポン・店の画像。公開中のオファーは終わる
//   残す … 確保・通報・運営の操作の記録・取得の記録（記録の表は追加だけ・基準 27.7）。店の行は番号だけ残し、店名を「退会した店」に伏せる
//   向かっている客 … 確保を取り消し、購読のある客へ知らせる（運営が店を止めたときと同じ流れ）

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  approvedStore,
  makeCtx,
  one,
  PUSH_SUBSCRIPTION,
  receivedScene,
  registerStore,
  rows,
  snapshot,
  uploadLicense,
  PDF_BYTES,
  HOUR,
  T0,
  type Ctx,
} from "../../../tests/acceptance/v2/_fakes";
import { WITHDRAWN_STORE_NAME } from "../domain/texts";
import { insertCouponWithinLimit } from "../repo/coupons";
import { replaceEmailVerification } from "../repo/emailVerifications";
import { runScheduledGoogleUpkeep } from "./googleUpkeep";
import { markCardRegistered, updateStoreLicense, updateStoreProfile } from "../repo/stores";

let ctx: Ctx;

beforeAll(async () => {
  ctx = await makeCtx();
});
afterAll(async () => {
  await ctx.dispose();
});

const WITHDRAW = "/api/store/withdraw";

/** その店の番号を名前に含む置き場のファイル（許可書は `licenses/<店>/…`、画像は `store-images/<店>`）。 */
const filesOf = (storeId: string): string[] => [...ctx.files.store.keys()].filter((key) => key.includes(storeId));

/** 受け取って完了済みにし、通報も1件入れた店（残るものを確かめる場面）。 */
const completedAndReportedScene = async () => {
  const scene = await receivedScene(ctx, { storeName: "退会を確かめる店", coupons: [{ name: "一杯目半額", note: "" }] });
  const done = await scene.store.api.post(`/api/store/reservations/${scene.reservation.id}/complete`, {});
  expect(done.status, done.text).toBe(200);
  const reported = await scene.customer.api.post("/api/customer/reports", { storeId: scene.store.id, reason: "検査の通報" });
  expect([200, 201]).toContain(reported.status);
  return scene;
};

describe("店の退会の入口（基準 13.13〜13.20）", () => {
  it("13.14 今のパスワードが合わなければ退会せず、D1 を1文字も変えない", async () => {
    const store = await approvedStore(ctx, { name: "パスワードを間違える店" });
    const before = await snapshot(ctx.db, { except: ["rate_counters"] });
    const r = await store.api.post(WITHDRAW, { currentPassword: "not-the-password" });
    expect(r.status).toBe(403);
    expect(r.json.error.kind).toBe("password_mismatch");
    expect(r.json.error.fields).toEqual([{ name: "currentPassword", reason: "not_allowed" }]);
    expect(await snapshot(ctx.db, { except: ["rate_counters"] })).toBe(before);
    // 今のパスワードを送らなければ形の断り
    expect((await store.api.post(WITHDRAW, {})).status).toBe(400);
  });

  it("13.15 退会すると、アカウント・セッション・店舗情報・営業許可書（置き場と表）・クーポン・店の画像が消え、公開中のオファーが終わる", async () => {
    const store = await approvedStore(ctx, { name: "消える店", coupons: [{ name: "ビール一杯", note: "おひとり1回" }] });
    const published = await store.api.post("/api/store/offers", { capacity: 2, partyMax: 4, couponIds: store.coupons.map((c) => c.id) });
    expect([200, 201]).toContain(published.status);
    expect(filesOf(store.id).length).toBeGreaterThan(0);
    // メールアドレスの確認のリンクを送った後の店（migration 0015 の控えの行はメールアドレスを持つ・2026-09-26 の合流の直し）
    const account = await one(ctx.db, "SELECT id FROM accounts WHERE store_id = ? AND role = 'store'", store.id);
    await replaceEmailVerification(ctx.db, {
      tokenHash: "withdraw-test-token-hash",
      accountId: account?.id as string,
      email: store.email,
      expiresAtIso: new Date(Date.parse(T0) + 24 * HOUR).toISOString(),
      createdAtIso: T0,
    });

    const r = await store.api.post(WITHDRAW, { currentPassword: store.password });
    expect(r.status, r.text).toBe(200);
    expect(r.json).toEqual({ ok: true, cancelled: 0 });
    expect(await rows(ctx.db, "SELECT token_hash FROM email_verifications WHERE account_id = ?", account?.id)).toEqual([]);
    // 退会と同時に走った確認メールの発行が、消えたアカウントの控えの行を書き戻さない
    await replaceEmailVerification(ctx.db, {
      tokenHash: "withdraw-test-token-hash-late",
      accountId: account?.id as string,
      email: store.email,
      expiresAtIso: new Date(Date.parse(T0) + 24 * HOUR).toISOString(),
      createdAtIso: T0,
    });
    expect(await rows(ctx.db, "SELECT token_hash FROM email_verifications WHERE account_id = ?", account?.id)).toEqual([]);
    // 端末のセッションの Cookie も消す（Max-Age=0）
    expect(r.setCookies.some((c) => /Max-Age=0/i.test(c))).toBe(true);

    expect(await rows(ctx.db, "SELECT id FROM accounts WHERE store_id = ?", store.id)).toEqual([]);
    expect(await rows(ctx.db, "SELECT token_hash FROM sessions s WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = s.account_id)")).toEqual([]);
    expect(await rows(ctx.db, "SELECT id FROM coupons WHERE store_id = ?", store.id)).toEqual([]);
    expect(filesOf(store.id)).toEqual([]);
    const row = await one(ctx.db, "SELECT * FROM stores WHERE id = ?", store.id);
    expect(row).toMatchObject({
      name: WITHDRAWN_STORE_NAME,
      status: "banned",
      address: null,
      lat: null,
      lng: null,
      url: null,
      genres: "[]",
      menus: "[]",
      budget_min: null,
      budget_max: null,
      license_key: null,
      license_mime: null,
      approved_name: null,
      approved_address: null,
      approved_license_key: null,
      card_registered_at: null,
      card_setup_session_id: null,
      stripe_customer_id: null,
      geocoded_at: null,
    });
    expect(row?.withdrawn_at).toBeTruthy();
    const offer = await one(ctx.db, "SELECT ended_at, end_reason FROM offers WHERE id = ?", published.json.offer.id);
    expect(offer?.ended_at).toBeTruthy();
    expect(offer?.end_reason).toBe("withdrawn");
    // 店のメールアドレス・住所・URL は D1 のどこにも残らない（端末の印の行も、メールアドレスの確認の控えの行も消える）
    const all = await snapshot(ctx.db);
    expect(all).not.toContain(store.email);
    expect(all).not.toContain(store.profile.address);
  });

  it("13.16 過去の確保・通報・運営の操作の記録・取得の記録は残り、店の行は番号だけで店名が「退会した店」になる", async () => {
    const scene = await completedAndReportedScene();
    const counts = async () => ({
      reservations: (await rows(ctx.db, "SELECT id FROM reservations WHERE store_id = ?", scene.store.id)).length,
      reports: (await rows(ctx.db, "SELECT id FROM reports WHERE store_id = ?", scene.store.id)).length,
      adminActions: (await rows(ctx.db, "SELECT id FROM admin_actions WHERE store_id = ?", scene.store.id)).length,
      fetchItems: (await rows(ctx.db, "SELECT id FROM fetch_items WHERE store_id = ?", scene.store.id)).length,
      selections: (await rows(ctx.db, "SELECT id FROM selections WHERE store_id = ?", scene.store.id)).length,
      events: (await rows(ctx.db, "SELECT e.id FROM reservation_events e JOIN reservations r ON r.id = e.reservation_id WHERE r.store_id = ?", scene.store.id)).length,
    });
    const before = await counts();
    expect(before.reservations).toBe(1);
    expect(before.reports).toBe(1);
    expect(before.adminActions).toBeGreaterThan(0);

    expect((await scene.store.api.post(WITHDRAW, { currentPassword: scene.store.password })).status).toBe(200);

    expect(await counts()).toEqual(before);
    expect(await one(ctx.db, "SELECT status FROM reservations WHERE id = ?", scene.reservation.id)).toMatchObject({ status: "completed" });
    // 店に見せるために写した客の電話番号は、見る店がもう無いので消す
    expect(await one(ctx.db, "SELECT customer_phone FROM reservations WHERE id = ?", scene.reservation.id)).toMatchObject({ customer_phone: null });
  });

  it("13.17 向かっている客の確保は取り消され、記録が1件ずつ付き、購読のある客に知らせる", async () => {
    const scene = await receivedScene(ctx, { storeName: "客が向かっている店" });
    expect((await scene.customer.api.post("/api/customer/push-subscription", { subscription: PUSH_SUBSCRIPTION })).status).toBe(200);
    const pushesBefore = ctx.push.calls.length;

    const r = await scene.store.api.post(WITHDRAW, { currentPassword: scene.store.password });
    expect(r.status, r.text).toBe(200);
    expect(r.json).toEqual({ ok: true, cancelled: 1 });

    expect(await one(ctx.db, "SELECT status FROM reservations WHERE id = ?", scene.reservation.id)).toMatchObject({ status: "store_cancelled" });
    expect(await rows(ctx.db, "SELECT id FROM reservation_events WHERE reservation_id = ? AND status = 'store_cancelled'", scene.reservation.id)).toHaveLength(1);
    // 退会の取り消しは「来ない（枠が戻る）」ではない（migration 0013・基準 18.16）: 理由は空（店の都合）で、枠は押さえたまま。
    // オファーごと同じまとまりで終わるので、枠が戻らないことは客に見えない（2026-09-26 の合流の直し）
    expect(await one(ctx.db, "SELECT cancel_reason, holds_slot FROM reservations WHERE id = ?", scene.reservation.id)).toMatchObject({ cancel_reason: null, holds_slot: 1 });
    expect(await rows(ctx.db, "SELECT reason FROM reservation_events WHERE reservation_id = ? AND status = 'store_cancelled'", scene.reservation.id)).toEqual([{ reason: null }]);
    expect(await one(ctx.db, "SELECT ended_at, end_reason FROM offers WHERE id = ?", scene.offer.id)).toMatchObject({ end_reason: "withdrawn" });
    expect(ctx.push.calls.length).toBe(pushesBefore + 1);
    // 知らせの文面は「お店の都合で取り消された」（運営の都合ではない）
    const message = await scene.customer.api.get("/api/customer/push-message");
    expect(message.json.scene).toBe("store_cancelled");

    // 客のホームと見返しには「退会した店」と出る
    const home = await scene.customer.api.get("/api/customer/home");
    expect(home.json.kind).toBe("store_cancelled");
    expect(home.json.reservation.storeName).toBe(WITHDRAWN_STORE_NAME);
    const history = await scene.customer.api.get("/api/customer/history");
    expect(history.json.items[0]).toMatchObject({ storeName: WITHDRAWN_STORE_NAME, storeAddress: "", storeUrl: null });
  });

  it("13.18 退会した店のセッションは効かず、同じパスワードでもログインできず、二重の退会は 401 で何も変えない", async () => {
    const store = await approvedStore(ctx, { name: "二度退会する店" });
    const otherDevice = await ctx.api().post("/api/auth/login", { email: store.email, password: store.password, humanToken: "tok-ok" });
    expect(otherDevice.status).toBe(200);
    const otherCookie = otherDevice.setCookies[0]!.split(";")[0]!;

    expect((await store.api.post(WITHDRAW, { currentPassword: store.password })).status).toBe(200);
    const before = await snapshot(ctx.db, { except: ["rate_counters"] });

    expect((await store.api.get("/api/store/home")).status).toBe(401);
    expect((await ctx.api(otherCookie).get("/api/store/home")).status).toBe(401);
    expect((await store.api.post(WITHDRAW, { currentPassword: store.password })).status).toBe(401);
    const login = await ctx.api().post("/api/auth/login", { email: store.email, password: store.password, humanToken: "tok-ok" });
    expect(login.status).toBe(401);
    expect(await snapshot(ctx.db, { except: ["rate_counters"] })).toBe(before);
  });

  it("退会と同時に走った店の書き込み（店舗情報の保存・許可書の上げ直し・カード・クーポン）は、伏せた行に書き戻さない（レビューの指摘）", async () => {
    const store = await approvedStore(ctx, { name: "同時に書き込む店" });
    expect((await store.api.post(WITHDRAW, { currentPassword: store.password })).status).toBe(200);
    // 見分けを退会の前に通った要求が、あとから repo の文を流した場面
    await updateStoreProfile(ctx.deps.db, store.id, { ...store.profile, budgetMin: 1000, budgetMax: 3000, lat: 35.6, lng: 139.7 });
    await updateStoreLicense(ctx.deps.db, store.id, "licenses/late-upload", "application/pdf", T0);
    await markCardRegistered(ctx.deps.db, store.id, T0);
    expect(await insertCouponWithinLimit(ctx.deps.db, { id: "late-coupon", storeId: store.id, name: "遅れた作成", note: "", createdAtIso: T0 }, 10)).toBe(false);
    expect(await one(ctx.db, "SELECT name, address, license_key, card_registered_at FROM stores WHERE id = ?", store.id)).toEqual({
      name: WITHDRAWN_STORE_NAME,
      address: null,
      license_key: null,
      card_registered_at: null,
    });
  });

  it("セッションを延ばす間際に退会しても、端末のセッションの Cookie は消える（延ばした Cookie を後ろに足さない・レビューの指摘）", async () => {
    const store = await approvedStore(ctx, { name: "期限の間際に退会する店" });
    ctx.clock.set(new Date(new Date(T0).getTime() + 24.5 * HOUR).toISOString());
    try {
      const r = await store.api.post(WITHDRAW, { currentPassword: store.password });
      expect(r.status, r.text).toBe(200);
      const sessionCookies = r.setCookies.filter((c) => c.startsWith("aihack_session="));
      expect(sessionCookies).toHaveLength(1);
      expect(sessionCookies[0]).toMatch(/Max-Age=0/i);
    } finally {
      ctx.clock.set(T0);
    }
  });

  it("13.19 退会した店のメールアドレスで、もう一度（新しい店として）登録できる", async () => {
    const store = await approvedStore(ctx, { name: "登録し直す店" });
    expect((await store.api.post(WITHDRAW, { currentPassword: store.password })).status).toBe(200);
    const again = await registerStore(ctx, { name: "登録し直した店", email: store.email });
    expect(again.id).not.toBe(store.id);
    expect(await one(ctx.db, "SELECT status, name FROM stores WHERE id = ?", again.id)).toMatchObject({ status: "pending", name: "登録し直した店" });
  });

  it("13.20 運営の一覧と詳細は「退会済み」の時刻を持ち、退会した店は戻せず、同じ店名の重複にも数えない", async () => {
    const store = await approvedStore(ctx, { name: "運営から見る退会の店" });
    const other = await approvedStore(ctx, { name: "運営から見るもう1つの退会の店" });
    expect((await store.api.post(WITHDRAW, { currentPassword: store.password })).status).toBe(200);
    expect((await other.api.post(WITHDRAW, { currentPassword: other.password })).status).toBe(200);
    const admin = ctx.admin!.api;

    const list = await admin.get("/api/admin/stores");
    const row = list.json.items.find((item: { id: string }) => item.id === store.id);
    expect(row).toMatchObject({ name: WITHDRAWN_STORE_NAME, email: null, address: null, status: "banned" });
    expect(row.withdrawnAt).toBeTruthy();

    const detail = await admin.get(`/api/admin/stores/${store.id}`);
    expect(detail.json.store.withdrawnAt).toBeTruthy();
    expect(detail.json.store.duplicates).toBe(0);
    expect(detail.json.history.length).toBeGreaterThan(0);

    const before = await snapshot(ctx.db);
    const restore = await admin.post(`/api/admin/stores/${store.id}/restore`, { reason: "戻そうとする" });
    expect(restore.status).toBe(404);
    expect(await snapshot(ctx.db)).toBe(before);
  });

  it("未承認の店も退会でき、上げていた営業許可書は置き場からも消える", async () => {
    const store = await registerStore(ctx, { name: "承認を待たずに退会する店" });
    expect((await uploadLicense(store.api, PDF_BYTES)).status).toBe(200);
    expect(filesOf(store.id).length).toBe(1);
    const r = await store.api.post(WITHDRAW, { currentPassword: store.password });
    expect(r.status, r.text).toBe(200);
    expect(filesOf(store.id)).toEqual([]);
    expect(await one(ctx.db, "SELECT status, name, license_key FROM stores WHERE id = ?", store.id)).toMatchObject({ status: "banned", name: WITHDRAWN_STORE_NAME, license_key: null });
  });

  it("登録取り消し済みの店は、この入口では退会できない（運営への連絡で受ける・D1 を変えない）", async () => {
    const store = await approvedStore(ctx, { name: "登録を取り消された店" });
    const banned = await ctx.admin!.api.post(`/api/admin/stores/${store.id}/ban`, { reason: "検査の理由" });
    expect(banned.status, banned.text).toBe(200);
    const before = await snapshot(ctx.db, { except: ["rate_counters"] });
    const r = await store.api.post(WITHDRAW, { currentPassword: store.password });
    expect(r.status).toBe(409);
    expect(r.json.error.kind).toBe("store_banned");
    expect(await snapshot(ctx.db, { except: ["rate_counters"] })).toBe(before);
  });

  it("仮のパスワードのままの店は、決め直すまで退会できない（基準 14.14 の入口の絞り）", async () => {
    const store = await approvedStore(ctx, { name: "仮のパスワードの店" });
    const issued = await ctx.admin!.api.post(`/api/admin/stores/${store.id}/temp-password`, { currentPassword: ctx.admin!.password });
    expect(issued.status, issued.text).toBe(200);
    const login = await ctx.api().post("/api/auth/login", { email: store.email, password: issued.json.tempPassword, humanToken: "tok-ok" });
    const temp = ctx.api(login.setCookies[0]!.split(";")[0]!);
    expect((await temp.post(WITHDRAW, { currentPassword: issued.json.tempPassword })).status).toBe(403);
    expect(await rows(ctx.db, "SELECT id FROM accounts WHERE store_id = ?", store.id)).toHaveLength(1);
  });
});

describe("退会した店と Google の座標の手入れ（2026-09-26 の合流の直し・Service Specific Terms 6.3.1）", () => {
  it("退会で店の座標と取った時刻が消え、手入れと定期実行は退会した店に触れない（地図にも聞かない）", async () => {
    const store = await approvedStore(ctx, { name: "座標のある退会する店" });
    // 30日を過ぎた Google の座標を持つ店（取り直しと消去の両方の対象になる形）
    const overdue = new Date(Date.parse(T0) - 31 * 24 * HOUR).toISOString();
    await ctx.db.prepare("UPDATE stores SET lat = 35.1, lng = 139.1, geocoded_at = ?2 WHERE id = ?1").bind(store.id, overdue).run();
    expect((await store.api.post(WITHDRAW, { currentPassword: store.password })).status).toBe(200);

    const erased = await one(ctx.db, "SELECT * FROM stores WHERE id = ?", store.id);
    expect(erased).toMatchObject({ address: null, lat: null, lng: null, geocoded_at: null });

    const asked: string[] = [];
    await ctx.db.prepare("DELETE FROM rate_counters WHERE key LIKE 'upkeep:%'").run();
    await runScheduledGoogleUpkeep({
      ...ctx.deps,
      geocoder: { geocode: async (text) => (asked.push(text), { ok: true, lat: 35.6, lng: 139.7 }) },
    });
    expect(asked).not.toContain(store.profile.address);
    expect(await one(ctx.db, "SELECT * FROM stores WHERE id = ?", store.id)).toEqual(erased);
  });
});
