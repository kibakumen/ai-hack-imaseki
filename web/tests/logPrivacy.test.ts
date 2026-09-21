// ログに個人データを出さないこと（設計の決め・`d01-log-privacy.test.ts` が見るはずの性質）。
//
// ⚠️ **なぜ同じ性質の検査を web/ 側にも置いたか**（2026-09-22 タスク25）:
// 受け入れ検査 `d01-log-privacy.test.ts` は `ctx.withDeps({ logger })` で場面を作り直すが、
// `tests/acceptance/v2/_fakes.ts` の `withDeps` は**偽物を渡し直していない**——`buildCtx` が
// `ctx.geocoder`・`ctx.ai` などに新しい偽物を入れる一方、app が使う `deps` は `opts.deps` で
// 親の偽物に上書きされる（時計だけは明示的に引き継いでいる）。そのため `approvedStore(rc, …)` の
// 中の `ctx.geocoder.set(住所, …)` が**どこにも繋がっていない偽物**に書き込み、住所が位置に
// 直せず 409 `address_unresolved` で場面が作れずに落ちる。受け入れ検査は凍結されているので
// 直せない（実測: `rc.geocoder === rc.deps.geocoder` が false・`rc.clock === rc.deps.clock` は true）。
//
// そこで**同じ性質を、壊れていない道（`makeCtx({ deps: { logger } })`）で**確かめる。
// `makeCtx` は渡した差し替え口だけを差し替え、残りは自分で作った偽物をそのまま deps に入れるので、
// `ctx.geocoder` と `deps.geocoder` が同じ物になる。
// `_fakes.ts` の `withDeps` が直ったら、この検査は受け入れ検査と重なるので落としてよい。

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { approvedStore, fetchOffers, loadWeb, makeCtx, publishOffer, receive, registerCustomer, type Ctx } from "../../tests/acceptance/v2/_fakes";
import type { Logger } from "../lib/ports";

/** ログに出てはいけない値。1つでも混ざれば見つかるように、ほかと重ならない文字列にする。 */
const MARKERS = {
  nickname: "めじるしのなまえ",
  phone: "08019190019",
  storeEmail: "marker-store@example.com",
  password: "marker-password-9",
  place: "めじるしの場所",
  reason: "めじるしの理由",
};

/** Logger に入れてよい項目（設計書「ログに何を書くか」）。自由な文字列の項目を増やさない。 */
const ALLOWED_STRING_KEYS = ["event", "errorKind", "id"];

type LogEntry = Parameters<Logger["log"]>[0];

let ctx: Ctx;
const consoleLines: string[] = [];
const entries: LogEntry[] = [];

beforeAll(async () => {
  const { createLogger } = await loadWeb<{ createLogger: () => Logger }>("lib/adapters/logger");
  const real = createLogger();
  // 偽の Logger と実物の両方へ流す——実物が console へ何を書くかも一緒に見たいため。
  const logger: Logger = {
    log: (entry) => {
      entries.push(entry);
      real.log(entry);
    },
  };
  for (const level of ["log", "error", "warn", "info", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      consoleLines.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    });
  }
  ctx = await makeCtx({ deps: { logger } });
});

afterAll(async () => {
  vi.restoreAllMocks();
  await ctx.dispose();
});

describe("ログに個人データを出さない", () => {
  it("通る場合と、壊れた入力・AI の失敗・地図の失敗の場合の両方で、console にも Logger にも目印の値が無い", async () => {
    const store = await approvedStore(ctx, { name: "ログの店", email: MARKERS.storeEmail, password: MARKERS.password });
    await publishOffer(store.api);
    const customer = await registerCustomer(ctx, { nickname: MARKERS.nickname, phone: MARKERS.phone });
    const found = await fetchOffers(customer.api, { party: 2 });
    const offerId = (await store.api.get("/api/store/home")).json.offer.id;
    await receive(customer.api, { offerId, party: 2, fetchId: found.json.fetchId });
    await customer.api.post("/api/customer/reports", { storeId: store.id, reason: MARKERS.reason });
    await ctx.api().post("/api/auth/login", { email: MARKERS.storeEmail, password: MARKERS.password, humanToken: "tok-ok" });

    // 断られる道（入力の誤り・もう在るメールアドレス・JSON になっていない本文）
    await ctx.api().post("/api/register/customer", { nickname: MARKERS.nickname, phone: "abc", genres: [], humanToken: "tok-ok" });
    await ctx.api().post("/api/register/store", { name: "x", email: MARKERS.storeEmail, password: MARKERS.password, humanToken: "tok-ok" });
    await ctx
      .api()
      .raw(new Request("https://app.test/api/register/customer", { method: "POST", headers: { "content-type": "application/json", origin: "https://app.test" }, body: `{ broken ${MARKERS.nickname}` }));

    // 外の口が落ちる道（AI が投げる・地図が投げる）
    ctx.ai.respond(() => {
      throw new Error(`AI down while serving ${MARKERS.nickname}`);
    });
    await fetchOffers(customer.api, { party: 2 });
    ctx.geocoder.set(MARKERS.place, "fail");
    await customer.api.post("/api/customer/fetch", { place: MARKERS.place, party: 2, genres: [], budgetMax: null });
    await customer.api.post("/api/customer/reports", { storeId: store.id, reason: "" });

    const cookieValue = customer.cookie.split("=").slice(1).join("=");
    const all = `${consoleLines.join("\n")}\n${JSON.stringify(entries)}`;
    for (const [name, value] of Object.entries({ ...MARKERS, cookieValue })) expect(all, name).not.toContain(value);
    expect(entries.length).toBeGreaterThan(0);
  });

  it("Logger の項目に自由な文字列が無く、語は小文字と記号だけ", () => {
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      for (const [key, value] of Object.entries(entry)) {
        if (typeof value === "string") expect(ALLOWED_STRING_KEYS, `Logger の項目 ${key} が自由な文字列`).toContain(key);
        if (key === "event" || key === "errorKind") expect(String(value), key).toMatch(/^[a-z0-9_.-]+$/);
      }
    }
  });
});
