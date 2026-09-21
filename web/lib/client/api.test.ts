// 応答をスキーマで検査してから返すこと（基準 29.4）。判定記録 docs/specs/v2/audits/task-2-c1.verdict.json の
// F2（応答を検査せず as T でキャストしていた）を固定する。
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { apiCall, type ApiFailure } from "./api";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** 応答を1つだけ返す偽物を置く（外へは出ない）。 */
const respondWith = (status: number, body: unknown): void => {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;
};

type Ok = { ok: true; id: string };
const failureOf = (value: Ok | ApiFailure): ApiFailure => {
  expect(value.ok).toBe(false);
  return value as ApiFailure;
};

describe("client/api が応答の形を確かめてから返す", () => {
  it("入力の断りは例外にせず、項目の一覧も落とさずに返る", async () => {
    respondWith(400, { ok: false, error: { kind: "invalid_input", fields: [{ name: "nickname", reason: "too_long" }] } });
    const failure = failureOf(await apiCall<Ok>("POST", "/api/register/customer", { nickname: "x" }));
    expect(failure.error?.kind).toBe("invalid_input");
    expect(failure.error?.fields).toEqual([{ name: "nickname", reason: "too_long" }]);
  });

  it("受け取りの断りは refusal と home を削らずに返る", async () => {
    respondWith(409, { ok: false, refusal: { kind: "party_over_max", partyMax: 3, nextStep: "search_again_with_party" }, home: { kind: "fetch" } });
    const failure = failureOf(await apiCall<Ok>("POST", "/api/customer/reservations", { offerId: "o1" }));
    expect(failure.refusal?.kind).toBe("party_over_max");
    expect(failure.refusal?.partyMax).toBe(3);
    expect(failure.home).toEqual({ kind: "fetch" });
  });

  it("状態による断り（current.state）も返る", async () => {
    respondWith(409, { ok: false, current: { state: "customer_cancelled" } });
    expect(failureOf(await apiCall<Ok>("POST", "/api/store/reservations/r1/complete")).current?.state).toBe("customer_cancelled");
  });

  it("中身を持たない断り（未ログインの 401）もそのまま返る", async () => {
    respondWith(401, { ok: false });
    const failure = failureOf(await apiCall<Ok>("GET", "/api/customer/home"));
    expect(failure.error).toBeUndefined();
  });

  it("約束と違う形の断り（error が物でない）は kind network に倒す", async () => {
    respondWith(400, { ok: false, error: "こわれている" });
    expect(failureOf(await apiCall<Ok>("POST", "/api/customer/fetch", {})).error?.kind).toBe("network");
  });

  it("JSON でない応答と通信の失敗は kind network", async () => {
    globalThis.fetch = (async () => new Response("<html>", { status: 502 })) as typeof fetch;
    expect(failureOf(await apiCall<Ok>("GET", "/api/customer/home")).error?.kind).toBe("network");
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    expect(failureOf(await apiCall<Ok>("GET", "/api/customer/home")).error?.kind).toBe("network");
  });

  it("成功の応答は、形を渡せばその形で検査して返す。合わなければ kind network", async () => {
    const schema = z.object({ ok: z.literal(true), id: z.string() });
    respondWith(200, { ok: true, id: "r1" });
    expect(await apiCall<Ok>("POST", "/api/customer/reservations", { offerId: "o1" }, schema)).toEqual({ ok: true, id: "r1" });
    respondWith(200, { ok: true, id: 7 });
    expect(failureOf(await apiCall<Ok>("POST", "/api/customer/reservations", { offerId: "o1" }, schema)).error?.kind).toBe("network");
  });

  it("形を渡さない成功の応答はそのまま返る", async () => {
    respondWith(200, { ok: true, id: "r2" });
    expect(await apiCall<Ok>("GET", "/api/customer/home")).toEqual({ ok: true, id: "r2" });
  });
});
