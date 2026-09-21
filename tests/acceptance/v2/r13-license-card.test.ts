// 要件13 営業許可書とカードの登録（手続き・入口）。画面は r13-license-card.ui.test.tsx。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { GIF_BYTES, JPEG_BYTES, loadWeb, makeCtx, one, PDF_BYTES, PNG_BYTES, registerCustomer, registerStore, seedAdmin, uploadLicense, type Ctx } from "./_fakes";

describeTask("7", "営業許可書とカード", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
    await seedAdmin(ctx);
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("13.1・13.2・13.3 PDF・JPEG・PNG は通り、GIF・拡張子だけ偽ったファイル・10MB＋1バイトは保存されず理由が返る", async () => {
    const s = await registerStore(ctx);
    for (const [bytes, name, type] of [[PDF_BYTES, "a.pdf", "application/pdf"], [JPEG_BYTES, "a.jpg", "image/jpeg"], [PNG_BYTES, "a.png", "image/png"]] as const) {
      const r = await uploadLicense(s.api, bytes, name, type);
      expect([200, 201], name).toContain(r.status);
    }
    const keysAfterOk = [...ctx.files.store.keys()].length;
    for (const [bytes, name, type, kind] of [
      [GIF_BYTES, "a.gif", "image/gif", "file_unsupported"],
      [GIF_BYTES, "fake.pdf", "application/pdf", "file_unsupported"],
      [new Uint8Array([...PDF_BYTES, ...new Uint8Array(10 * 1024 * 1024 + 1 - PDF_BYTES.length)]), "big.pdf", "application/pdf", "file_too_large"],
    ] as const) {
      const r = await uploadLicense(s.api, bytes, name, type);
      expect(r.status, name).toBe(400);
      expect(r.json.error.kind, name).toBe(kind);
      expect(r.json.error.fields.map((f: any) => f.name)).toContain("file");
    }
    expect([...ctx.files.store.keys()].length).toBe(keysAfterOk);
    const { detectFileType } = await loadWeb("lib/domain/fileType");
    expect(detectFileType(PDF_BYTES)).toBe("application/pdf");
    expect(detectFileType(JPEG_BYTES)).toBe("image/jpeg");
    expect(detectFileType(PNG_BYTES)).toBe("image/png");
    expect(detectFileType(GIF_BYTES)).toBeNull();
  });

  it("13.4 上げ直すと前のファイルが消え、読むと新しい方が返る", async () => {
    const s = await registerStore(ctx);
    await uploadLicense(s.api, PDF_BYTES, "first.pdf");
    const first = [...ctx.files.store.keys()];
    await uploadLicense(s.api, PNG_BYTES, "second.png", "image/png");
    const keysForStore = (await one(ctx.db, "SELECT license_key, license_mime FROM stores WHERE id = ?", s.id))!;
    expect(keysForStore.license_mime).toBe("image/png");
    for (const k of first) if (k !== keysForStore.license_key) expect(ctx.files.store.has(k)).toBe(false);
    const read = await s.api.get("/api/store/license");
    expect(read.status).toBe(200);
    expect(read.headers.get("content-type")).toBe("image/png");
    expect(read.headers.get("cache-control")).toMatch(/no-store/);
    expect(read.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("13.5 別の店・客・未ログインの要求は断られ、上げた店と運営は読める（運営の入口も同じ見出しつき）", async () => {
    const s = await registerStore(ctx);
    await uploadLicense(s.api, PDF_BYTES);
    const other = await registerStore(ctx);
    const customer = await registerCustomer(ctx);
    expect([403, 404]).toContain((await other.api.get(`/api/admin/stores/${s.id}/license`)).status);
    expect((await other.api.get("/api/store/license")).status).toBe(404);
    expect([401, 403]).toContain((await customer.api.get("/api/store/license")).status);
    expect((await ctx.api().get("/api/store/license")).status).toBe(401);
    expect((await s.api.get("/api/store/license")).status).toBe(200);
    const admin = await ctx.admin!.api.get(`/api/admin/stores/${s.id}/license`);
    expect(admin.status).toBe(200);
    expect(admin.headers.get("content-type")).toBe("application/pdf");
    expect(admin.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("13.6・13.8・13.9 偽のカードの口が成功→登録済み／失敗・別の店のセッション→登録済みにならず card_setup_failed。応答にあるのは登録済みかどうかだけ", async () => {
    const s = await registerStore(ctx);
    const other = await registerStore(ctx);
    ctx.card.setupOk = false;
    const failSetup = await s.api.post("/api/store/card/setup", {});
    expect([409, 502]).toContain(failSetup.status);
    expect(failSetup.json.error.kind).toBe("card_setup_failed");
    ctx.card.setupOk = true;
    const setup = await s.api.post("/api/store/card/setup", {});
    expect(setup.status).toBe(200);
    expect(setup.json.url).toMatch(/^https:\/\//);
    const sessionId = setup.json.url.split("/").pop();
    const wrong = await other.api.post("/api/store/card/confirm", { sessionId });
    expect(wrong.status).toBe(409);
    expect(wrong.json.error.kind).toBe("card_setup_failed");
    expect((await other.api.get("/api/store/home")).json.checklist.card).toBe(false);
    ctx.card.confirmOk = false;
    const failConfirm = await s.api.post("/api/store/card/confirm", { sessionId });
    expect(failConfirm.status).toBe(409);
    expect((await s.api.get("/api/store/home")).json.checklist.card).toBe(false);
    ctx.card.confirmOk = true;
    const ok = await s.api.post("/api/store/card/confirm", { sessionId });
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ ok: true, cardRegistered: true });
    expect((await s.api.get("/api/store/home")).json.checklist.card).toBe(true);
    const home = await s.api.get("/api/store/home");
    expect(JSON.stringify(home.json)).not.toMatch(/cs_test_|stripe\.test|4242/);
    expect((await one(ctx.db, "SELECT card_registered_at FROM stores WHERE id = ?", s.id)).card_registered_at).toBeTruthy();
  });
});
