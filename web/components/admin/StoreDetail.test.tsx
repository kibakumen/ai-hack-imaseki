// @vitest-environment jsdom
// 運営の店の詳細の画面（2026-09-25 監査の指摘 運営-01・運営-02・運営-03・運営-04・運営-05・運営-06・
// 運営-09・運営-13・横断-09）。
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { installFakeApi, refusal, type FakeApi } from "../../../tests/acceptance/v2/_fakes";
import { StoreDetail } from "./StoreDetail";

const STORE = {
  id: "store-1",
  name: "検査の店",
  address: "東京都渋谷区1-1",
  email: "s@example.com",
  status: "approved",
  publishing: true,
  createdAt: "2026-09-01T00:00:00.000Z",
  claims: 5,
  offerRemaining: 2,
  genres: ["和食"],
  menus: ["刺身"],
  budgetMin: 1000,
  budgetMax: 3000,
  url: null,
  license: true,
  cardRegistered: true,
  changedSinceApproval: false,
  contacted: false,
  storeCancelled: 0,
  storeCancelRate: 0,
  licenseUploadedAt: "2026-09-02T01:00:00.000Z",
  approval: { at: "2026-09-03T00:00:00.000Z", name: "検査の店", address: "東京都渋谷区1-1", license: true },
  changes: { name: false, address: false, license: false },
  activeReservations: 0,
  duplicates: 0,
  note: null,
  contactedAt: null,
};

const detail = (over: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) => ({
  json: { store: { ...STORE, ...over }, reports: { count: 0, latest: [] }, history: [], ...extra },
});

const conflict = (state: string) => ({ status: 409, json: { ok: false, current: { state } } });

let api: FakeApi | null = null;
afterEach(() => {
  cleanup();
  api?.restore();
  api = null;
});

const postsTo = (suffix: string) => api!.calls.filter((c) => c.method === "POST" && c.path.endsWith(suffix));
const detailLoads = () => api!.calls.filter((c) => c.method === "GET" && c.path === "/api/admin/stores/store-1");

describe("取り消し・戻すの理由と、止めたときの影響（運営-01・運営-03）", () => {
  it("確かめに「今 N 組が向かっています」が出て、理由を入れるまで押せず、理由つきで送る。止めたあと取り消した組数と通知した人数が出る", async () => {
    api = installFakeApi({
      "GET /api/admin/stores/:id": () => detail({ activeReservations: 3 }),
      "POST /api/admin/stores/:id/ban": () => ({ json: { ok: true, cancelled: 3, notified: 2 } }),
    });
    render(<StoreDetail storeId="store-1" />);
    fireEvent.click(await screen.findByTestId("btn-ban"));
    const confirm = await screen.findByTestId("confirm-ban");
    expect(confirm.textContent).toMatch(/今 3 組が向かっています/);
    const go = within(confirm).getByTestId("btn-confirm") as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(within(confirm).getByTestId("field-reason"), { target: { value: "通報が3件続いたため" } });
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    await waitFor(() => expect(postsTo("/ban")).toHaveLength(1));
    expect(postsTo("/ban")[0].body).toEqual({ reason: "通報が3件続いたため" });
    expect((await screen.findByTestId("action-result")).textContent).toMatch(/3 組の確保をキャンセルし、2 人に通知しました/);
  });

  it("「戻せない操作」とは書かず、戻せるもの（店の承認）と戻せないもの（オファーと確保）を分けて書く", async () => {
    api = installFakeApi({ "GET /api/admin/stores/:id": () => detail() });
    render(<StoreDetail storeId="store-1" />);
    const form = await screen.findByTestId("form-ban");
    expect(form.textContent).not.toMatch(/戻せない操作です/);
    expect(form.textContent).toMatch(/終わったオファーとキャンセルした確保は戻せません（店の承認は戻せます）/);
  });

  it("戻すにも理由を求める", async () => {
    api = installFakeApi({ "GET /api/admin/stores/:id": () => detail({ status: "banned" }), "POST /api/admin/stores/:id/restore": () => ({ json: { ok: true, status: "approved" } }) });
    render(<StoreDetail storeId="store-1" />);
    fireEvent.click(await screen.findByTestId("btn-restore"));
    const confirm = await screen.findByTestId("confirm-restore");
    fireEvent.change(within(confirm).getByTestId("field-reason"), { target: { value: "店と電話で確かめた" } });
    fireEvent.click(within(confirm).getByTestId("btn-confirm"));
    await waitFor(() => expect(postsTo("/restore")).toHaveLength(1));
    expect(postsTo("/restore")[0].body).toEqual({ reason: "店と電話で確かめた" });
    expect((await screen.findByTestId("action-result")).textContent).toMatch(/承認済みに戻しました/);
  });

  // 2026-09-25 安全-20 のレビュー: 止めると営業許可書と承認の写しが消え、戻すと承認待ちになる。押す前にそれを言う
  it("止める確かめは営業許可書が消えることを言い、許可書を消した店（承認の写しが無い）を戻すときは承認待ちに戻ることを言う", async () => {
    api = installFakeApi({ "GET /api/admin/stores/:id": () => detail() });
    render(<StoreDetail storeId="store-1" />);
    fireEvent.click(await screen.findByTestId("btn-ban"));
    expect((await screen.findByTestId("confirm-ban")).textContent).toMatch(/営業許可書.*消え.*承認待ち/);
    cleanup();
    api.restore();

    api = installFakeApi({
      "GET /api/admin/stores/:id": () => detail({ status: "banned", license: false, approval: null }),
      "POST /api/admin/stores/:id/restore": () => ({ json: { ok: true, status: "pending" } }),
    });
    render(<StoreDetail storeId="store-1" />);
    const form = await screen.findByTestId("form-restore");
    expect(form.textContent).toMatch(/承認待ち/);
    fireEvent.click(within(form).getByTestId("btn-restore"));
    const confirm = await screen.findByTestId("confirm-restore");
    expect(confirm.textContent).toMatch(/承認待ちに戻り/);
    fireEvent.change(within(confirm).getByTestId("field-reason"), { target: { value: "誤って止めた" } });
    fireEvent.click(within(confirm).getByTestId("btn-confirm"));
    expect((await screen.findByTestId("action-result")).textContent).toMatch(/承認待ちに戻しました/);
  });

  it("仮のパスワードの発行は、運営自身の今のパスワードを入れてから送る。違えばその欄の直下に断りが出る", async () => {
    api = installFakeApi({
      "GET /api/admin/stores/:id": () => detail(),
      "POST /api/admin/stores/:id/temp-password": ({ body }) =>
        body?.currentPassword === "admin-pass-1234" ? { json: { ok: true, tempPassword: "TEMP-PASS" } } : refusal("password_mismatch", { fields: [{ name: "currentPassword", reason: "not_allowed" }] }),
    });
    render(<StoreDetail storeId="store-1" />);
    fireEvent.click(await screen.findByTestId("btn-temp-password"));
    const confirm = await screen.findByTestId("confirm-temp-password");
    const go = within(confirm).getByTestId("btn-confirm-temp-password") as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(within(confirm).getByTestId("field-currentPassword"), { target: { value: "wrong" } });
    fireEvent.click(go);
    expect(await within(confirm).findByTestId("msg-currentPassword")).toBeTruthy();
    fireEvent.change(within(confirm).getByTestId("field-currentPassword"), { target: { value: "admin-pass-1234" } });
    fireEvent.click(go);
    expect((await screen.findByTestId("temp-password")).textContent).toBe("TEMP-PASS");
  });

  it("操作の履歴が、操作した人・理由つきで出る", async () => {
    api = installFakeApi({
      "GET /api/admin/stores/:id": () =>
        detail({}, { history: [{ id: "a1", action: "ban", actorEmail: "admin@example.com", reason: "いたずらの疑い", detail: { cancelled: 2, notified: 1 }, at: "2026-09-22T06:00:00.000Z" }] }),
    });
    render(<StoreDetail storeId="store-1" />);
    const history = await screen.findByTestId("store-history");
    expect(history.textContent).toMatch(/登録の取り消し/);
    expect(history.textContent).toMatch(/admin@example\.com/);
    expect(history.textContent).toMatch(/いたずらの疑い/);
    expect(history.textContent).toMatch(/2 組/);
  });
});

describe("状況が先に変わっていたとき（運営-04）と、断りの出し場所（運営-13）", () => {
  it("409 の今の状況を受けたら「ほかの操作で、すでに『登録取り消し済み』になっていました」と出し、詳細を取り直す", async () => {
    let status = "approved";
    api = installFakeApi({
      "GET /api/admin/stores/:id": () => detail({ status }),
      "POST /api/admin/stores/:id/ban": () => {
        status = "banned";
        return conflict("banned");
      },
    });
    render(<StoreDetail storeId="store-1" />);
    fireEvent.click(await screen.findByTestId("btn-ban"));
    const confirm = await screen.findByTestId("confirm-ban");
    fireEvent.change(within(confirm).getByTestId("field-reason"), { target: { value: "x" } });
    fireEvent.click(within(confirm).getByTestId("btn-confirm"));
    expect((await screen.findByTestId("state-conflict")).textContent).toMatch(/ほかの操作で、すでに『登録取り消し済み』になっていました/);
    await waitFor(() => expect(detailLoads().length).toBeGreaterThanOrEqual(2));
    expect(await screen.findByTestId("form-restore")).toBeTruthy();
    expect(screen.queryByTestId("confirm-ban")).toBeNull();
  });

  it("承認は、詳細で見た店名・住所・許可書を上げた日時を載せて送る。見たあとで変わっていた断り（current.changed）なら、そう出して詳細を取り直す", async () => {
    let uploadedAt = "2026-09-02T01:00:00.000Z";
    api = installFakeApi({
      "GET /api/admin/stores/:id": () => detail({ status: "pending", approval: null, licenseUploadedAt: uploadedAt }),
      "POST /api/admin/stores/:id/approve": () => {
        uploadedAt = "2026-09-02T02:00:00.000Z";
        return { status: 409, json: { ok: false, current: { state: "pending", changed: true } } };
      },
    });
    render(<StoreDetail storeId="store-1" />);
    fireEvent.click(await screen.findByTestId("btn-approve"));
    const notice = await screen.findByTestId("state-conflict");
    expect(notice.textContent).toMatch(/店名・住所・営業許可書のどれかが変わりました/);
    expect(postsTo("/approve")[0].body).toEqual({ seen: { name: STORE.name, address: STORE.address, licenseUploadedAt: "2026-09-02T01:00:00.000Z" } });
    await waitFor(() => expect(detailLoads().length).toBeGreaterThanOrEqual(2));
    fireEvent.click(screen.getByTestId("btn-approve"));
    await waitFor(() => expect(postsTo("/approve")).toHaveLength(2));
    expect(postsTo("/approve")[1].body).toMatchObject({ seen: { licenseUploadedAt: "2026-09-02T02:00:00.000Z" } });
  });

  it("「今の内容を確かめた」も見た内容を載せて送り、見たあとで変わっていた断りなら、そう出して詳細を取り直す", async () => {
    const changedStore = { name: "近所の有名店", changedSinceApproval: true, changes: { name: true, address: false, license: false } };
    api = installFakeApi({
      "GET /api/admin/stores/:id": () => detail(changedStore),
      "POST /api/admin/stores/:id/acknowledge": () => ({ status: 409, json: { ok: false, current: { state: "approved", changed: true } } }),
    });
    render(<StoreDetail storeId="store-1" />);
    const box = await screen.findByTestId("approval-changes");
    fireEvent.click(within(box).getByTestId("btn-acknowledge"));
    await waitFor(() => expect(postsTo("/acknowledge")).toHaveLength(1));
    expect(postsTo("/acknowledge")[0].body).toEqual({ seen: { name: "近所の有名店", address: STORE.address, licenseUploadedAt: STORE.licenseUploadedAt } });
    expect((await screen.findByTestId("acknowledge-conflict")).textContent).toMatch(/店名・住所・営業許可書のどれかが変わりました/);
    await waitFor(() => expect(detailLoads().length).toBeGreaterThanOrEqual(2));
  });

  it("送っている間は確かめのボタンを押せない", async () => {
    let release: (value: { json: unknown }) => void = () => {};
    api = installFakeApi({
      "GET /api/admin/stores/:id": () => detail({ status: "banned" }),
      "POST /api/admin/stores/:id/restore": () => new Promise((resolve) => (release = resolve)),
    });
    render(<StoreDetail storeId="store-1" />);
    fireEvent.click(await screen.findByTestId("btn-restore"));
    const confirm = await screen.findByTestId("confirm-restore");
    fireEvent.change(within(confirm).getByTestId("field-reason"), { target: { value: "確かめた" } });
    const go = within(confirm).getByTestId("btn-confirm") as HTMLButtonElement;
    fireEvent.click(go);
    await waitFor(() => expect(go.disabled).toBe(true));
    fireEvent.click(go);
    expect(postsTo("/restore")).toHaveLength(1);
    release({ json: { ok: true, status: "approved" } });
  });

  it("承認の断りは承認の欄の1か所にだけ出る（仮のパスワードの欄には出ない）", async () => {
    api = installFakeApi({
      "GET /api/admin/stores/:id": () => detail({ status: "pending" }),
      "POST /api/admin/stores/:id/approve": () => refusal("approval_missing", { fields: [{ name: "license", reason: "required" }] }),
    });
    render(<StoreDetail storeId="store-1" />);
    fireEvent.click(await screen.findByTestId("btn-approve"));
    await waitFor(() => expect(screen.getAllByTestId("msg-form")).toHaveLength(1));
    expect(within(screen.getByTestId("form-approve")).getByTestId("msg-form")).toBeTruthy();
    expect(within(screen.getByTestId("form-temp-password")).queryByTestId("msg-form")).toBeNull();
  });

  it("「やめる」を押すと、その操作の断りも消える", async () => {
    api = installFakeApi({
      "GET /api/admin/stores/:id": () => detail(),
      "POST /api/admin/stores/:id/temp-password": () => refusal("password_mismatch", { fields: [{ name: "currentPassword", reason: "not_allowed" }] }),
    });
    render(<StoreDetail storeId="store-1" />);
    fireEvent.click(await screen.findByTestId("btn-temp-password"));
    const confirm = await screen.findByTestId("confirm-temp-password");
    fireEvent.change(within(confirm).getByTestId("field-currentPassword"), { target: { value: "wrong" } });
    fireEvent.click(within(confirm).getByTestId("btn-confirm-temp-password"));
    await within(confirm).findByTestId("msg-currentPassword");
    fireEvent.click(within(confirm).getByText("やめる"));
    fireEvent.click(screen.getByTestId("btn-temp-password"));
    expect(within(await screen.findByTestId("confirm-temp-password")).queryByTestId("msg-currentPassword")).toBeNull();
  });
});

describe("審査と停止の判断材料（運営-02・運営-03・運営-05・運営-09・横断-09）", () => {
  it("見出しの近くに、公開中かどうか・残りの枠・向かっている組数・その店への通報・店の取り消しの回数が出る", async () => {
    api = installFakeApi({
      "GET /api/admin/stores/:id": () =>
        detail(
          { activeReservations: 2, storeCancelled: 3, storeCancelRate: 0.25 },
          { reports: { count: 4, latest: [{ id: "r1", reason: "来たら閉まっていた", at: "2026-09-22T06:00:00.000Z", reporter: "a1b2c3" }] } },
        ),
    });
    render(<StoreDetail storeId="store-1" />);
    const impact = await screen.findByTestId("store-impact");
    expect(impact.textContent).toMatch(/オファー公開中/);
    expect(impact.textContent).toMatch(/残り 2 枠/);
    expect(impact.textContent).toMatch(/2 組が向かっています/);
    expect(impact.textContent).toMatch(/通報 4 件/);
    expect(impact.textContent).toMatch(/店のキャンセル 3 回（25%）/);
    const reports = screen.getByTestId("store-reports");
    expect(reports.textContent).toMatch(/来たら閉まっていた/);
    expect(reports.textContent).toMatch(/a1b2c3/);
  });

  it("承認後に店名・住所・許可書が変わった店は「承認後に変更あり」と承認した時点の値が出て、確かめると取り直す", async () => {
    let changed = true;
    api = installFakeApi({
      "GET /api/admin/stores/:id": () =>
        detail(
          changed
            ? { name: "近所の有名店", changedSinceApproval: true, changes: { name: true, address: false, license: true } }
            : { changedSinceApproval: false },
        ),
      "POST /api/admin/stores/:id/acknowledge": () => {
        changed = false;
        return { json: { ok: true } };
      },
    });
    render(<StoreDetail storeId="store-1" />);
    const box = await screen.findByTestId("approval-changes");
    expect(box.textContent).toMatch(/承認後に変更あり/);
    expect(box.textContent).toMatch(/検査の店/);
    expect(box.querySelector("a[href*='version=approved']")).toBeTruthy();
    fireEvent.click(within(box).getByTestId("btn-acknowledge"));
    await waitFor(() => expect(screen.queryByTestId("approval-changes")).toBeNull());
  });

  it("登録日時・許可書を上げた日時・同じ店名か住所の登録の数が出て、メモと「連絡済み」を保存できる", async () => {
    api = installFakeApi({
      "GET /api/admin/stores/:id": () => detail({ status: "pending", duplicates: 2 }),
      "POST /api/admin/stores/:id/note": () => ({ json: { ok: true } }),
    });
    render(<StoreDetail storeId="store-1" />);
    const review = await screen.findByTestId("store-review");
    expect(review.textContent).toMatch(/2026\/9\/1/);
    expect(review.textContent).toMatch(/2026\/9\/2/);
    expect(review.textContent).toMatch(/同じ店名か住所の登録がほかに 2 件/);
    const form = screen.getByTestId("form-note");
    fireEvent.change(within(form).getByTestId("field-note"), { target: { value: "再提出を依頼" } });
    fireEvent.click(within(form).getByTestId("field-contacted"));
    fireEvent.click(within(form).getByTestId("btn-save-note"));
    await waitFor(() => expect(postsTo("/note")).toHaveLength(1));
    expect(postsTo("/note")[0].body).toEqual({ note: "再提出を依頼", contacted: true });
  });

  it("一覧から来たときは、戻るリンクが絞り込みと検索と並び順を持ったまま一覧へ戻る（運営-06）", async () => {
    api = installFakeApi({ "GET /api/admin/stores/:id": () => detail() });
    render(<StoreDetail storeId="store-1" listQuery="filter=pending&q=%E5%BA%97&sort=claims_desc" />);
    const back = (await screen.findByText("← 店の一覧へ")) as HTMLAnchorElement;
    expect(back.getAttribute("href")).toBe("/admin?filter=pending&q=%E5%BA%97&sort=claims_desc");
  });
});
