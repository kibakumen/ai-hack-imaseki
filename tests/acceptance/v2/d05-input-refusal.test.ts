// 設計の決め: 入力の断りの応答の形と語が閉じている（第6周の直し）。
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeTask } from "./_tasks";
import { loadWeb, makeCtx, registerCustomer, snapshot, type Ctx } from "./_fakes";

const BAD_WORDS = ["不正", "誤り", "無効"];

describeTask("2", "入力の断りの語と文（純粋）", () => {
  it("domain/inputRefusal に閉じた語の一覧が在り、domain/texts が全部の kind と reason に文を持つ。文に責める語が無い", async () => {
    const { INPUT_REFUSAL_KINDS, FIELD_REASONS } = await loadWeb("lib/domain/inputRefusal");
    const { TEXTS } = await loadWeb("lib/domain/texts");
    for (const k of ["invalid_input", "party_over_max", "email_taken", "limit_reached", "coupon_in_use", "address_unresolved", "profile_incomplete", "offer_exists", "offer_ended", "until_in_past", "until_over_window", "approval_missing", "file_unsupported", "file_too_large", "card_setup_failed", "login_failed", "place_unresolved", "report_not_allowed", "human_check_failed", "rate_limited", "location_required", "network"]) {
      expect(INPUT_REFUSAL_KINDS, k).toContain(k);
    }
    for (const r of ["required", "too_short", "too_long", "out_of_range", "not_integer", "bad_format", "not_allowed", "too_many", "min_over_max", "over_capacity", "over_remaining", "in_past", "over_window"]) {
      expect(FIELD_REASONS, r).toContain(r);
    }
    for (const k of INPUT_REFUSAL_KINDS as string[]) {
      const text: string = TEXTS.inputRefusal(k, { partyMax: 4, latest: "03:00", max: 20 });
      expect(typeof text, k).toBe("string");
      expect(text.length, k).toBeGreaterThan(0);
      for (const w of BAD_WORDS) expect(text, `${k}: ${w}`).not.toContain(w);
    }
    for (const r of FIELD_REASONS as string[]) {
      const text: string = TEXTS.fieldReason(r, { field: "nickname", min: 1, max: 20, latest: "03:00" });
      expect(text.length, r).toBeGreaterThan(0);
      for (const w of BAD_WORDS) expect(text, `${r}: ${w}`).not.toContain(w);
    }
  });

  it("雛形に数字を渡すと文に入る（同じ reason でも数字を変えると文が変わる）", async () => {
    const { TEXTS } = await loadWeb("lib/domain/texts");
    const a: string = TEXTS.fieldReason("too_long", { field: "nickname", max: 20 });
    const b: string = TEXTS.fieldReason("too_long", { field: "nickname", max: 50 });
    expect(a).toContain("20");
    expect(b).toContain("50");
    expect(a).not.toBe(b);
    const win: string = TEXTS.inputRefusal("until_over_window", { latest: "03:00" });
    expect(win).toContain("03:00");
    expect(TEXTS.inputRefusal("until_in_past")).toContain("公開を止める");
  });

  it("受け取りの断りと次の一手にも文が在り、責める語が無い", async () => {
    const { TEXTS } = await loadWeb("lib/domain/texts");
    for (const k of ["sold_out", "offer_ended", "store_banned", "party_over_max", "has_active_reservation"]) {
      const text: string = TEXTS.receiveRefusal(k, { partyMax: 4 });
      expect(text.length, k).toBeGreaterThan(0);
      for (const w of BAD_WORDS) expect(text, k).not.toContain(w);
    }
    expect(TEXTS.receiveRefusal("party_over_max", { partyMax: 3 })).toContain("3");
    for (const s of ["search_again", "search_again_with_party", "back_to_reservation", "retry_same_party"]) {
      expect((TEXTS.nextStep(s, { partyMax: 2 }) as string).length, s).toBeGreaterThan(0);
    }
    expect(TEXTS.nextStep("search_again_with_party", { partyMax: 2 })).toContain("2");
    expect(TEXTS.fallbackReason).toBe("今の条件で近い順に選びました");
  });
});

describeTask("25", "入力の断りの応答の形（入口）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("zod の各種の落ちが閉じた語になる（文字列と数の両方）。項目名はスキーマの項目名", async () => {
    const api = ctx.api();
    const { FIELD_REASONS } = await loadWeb("lib/domain/inputRefusal");
    const cases: Array<{ body: Record<string, unknown>; field: string; reason: string }> = [
      { body: { nickname: "", phone: "09012345678", genres: [] }, field: "nickname", reason: "too_short" },
      { body: { nickname: "あ".repeat(21), phone: "09012345678", genres: [] }, field: "nickname", reason: "too_long" },
      { body: { phone: "09012345678", genres: [] }, field: "nickname", reason: "required" },
      { body: { nickname: "a", phone: "0901234", genres: [] }, field: "phone", reason: "bad_format" },
      { body: { nickname: "a", phone: "09012345678", genres: [], budgetMax: -1 }, field: "budgetMax", reason: "out_of_range" },
      { body: { nickname: "a", phone: "09012345678", genres: [], budgetMax: 100001 }, field: "budgetMax", reason: "out_of_range" },
      { body: { nickname: "a", phone: "09012345678", genres: [], budgetMax: 1.5 }, field: "budgetMax", reason: "not_integer" },
      { body: { nickname: "a", phone: "09012345678", genres: ["存在しないジャンル"] }, field: "genres", reason: "not_allowed" },
    ];
    for (const c of cases) {
      const r = await api.post("/api/register/customer", { humanToken: "tok", ...c.body });
      expect(r.status, JSON.stringify(c.body)).toBe(400);
      expect(r.json.ok).toBe(false);
      expect(r.json.error.kind).toBe("invalid_input");
      const f = r.json.error.fields.find((x: any) => x.name === c.field);
      expect(f, `${JSON.stringify(c.body)} → fields に ${c.field} が無い`).toBeTruthy();
      expect(f.reason, JSON.stringify(c.body)).toBe(c.reason);
      expect(FIELD_REASONS).toContain(f.reason);
      expect(JSON.stringify(r.json)).not.toMatch(/[ぁ-んァ-ン一-龠]/);
    }
  });

  it("手続きが規則で返す kind は全部一覧に在る（一覧に無い語を返すと落ちる）", async () => {
    const { INPUT_REFUSAL_KINDS } = await loadWeb("lib/domain/inputRefusal");
    const api = ctx.api();
    const c = await registerCustomer(ctx);
    const seen: string[] = [];
    const collect = (r: { status: number; json: any }) => {
      if (r.json?.ok === false && r.json.error?.kind) seen.push(r.json.error.kind);
    };
    collect(await api.post("/api/register/customer", { nickname: "a", phone: "09012345678", genres: [], humanToken: "tok" }));
    ctx.human.mode = "bot";
    collect(await api.post("/api/register/customer", { nickname: "a", phone: "09012345678", genres: [], humanToken: "tok" }));
    ctx.human.mode = "human";
    collect(await c.api.post("/api/customer/fetch", { place: "どこにもない場所", party: 2, genres: [], budgetMax: null }));
    collect(await api.post("/api/auth/login", { email: "nobody@example.com", password: "wrong-password", humanToken: "tok" }));
    collect(await c.api.post("/api/customer/reports", { storeId: "no-such-store", reason: "理由" }));
    expect(seen.length).toBeGreaterThanOrEqual(3);
    for (const k of seen) expect(INPUT_REFUSAL_KINDS, k).toContain(k);
  });

  it("client/api が ok:false を例外にせず同じ形で返し、通信の失敗を kind network で返す", async () => {
    const { apiCall } = await loadWeb("lib/client/api");
    const prev = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ ok: false, error: { kind: "invalid_input", fields: [{ name: "nickname", reason: "too_long" }] } }), { status: 400, headers: { "content-type": "application/json" } })) as typeof fetch;
    const refused = await apiCall("POST", "/api/register/customer", { nickname: "x" });
    expect(refused.ok).toBe(false);
    expect(refused.error.kind).toBe("invalid_input");
    expect(refused.error.fields[0]).toEqual({ name: "nickname", reason: "too_long" });
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    const failed = await apiCall("GET", "/api/customer/home");
    expect(failed.ok).toBe(false);
    expect(failed.error.kind).toBe("network");
    globalThis.fetch = prev;
  });

  it("検査に落ちた要求で D1 の全部の表が変わらない", async () => {
    const before = await snapshot(ctx.db, { except: ["rate_counters"] });
    await ctx.api().post("/api/register/customer", { nickname: "", phone: "x", genres: [], humanToken: "tok" });
    await ctx.api().post("/api/register/store", { name: "", email: "bad", password: "short", humanToken: "tok" });
    expect(await snapshot(ctx.db, { except: ["rate_counters"] })).toBe(before);
  });
});
