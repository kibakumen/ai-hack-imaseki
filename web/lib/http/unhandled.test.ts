// 想定外の例外を受け止める場所（監査の指摘 設計-15・2026-09-25）。
//
// それまで手続きが例外を投げると、Next の既定の 500（JSON でない本文）が返り、画面はそれを
// 「通信に失敗した」ものとして扱った。構造化されたログの出口も通らず、ログインの入口では
// 失敗の回数の数え上げも飛ばされていた。入口（defineRoute）と橋（serveSafely）で受け止め、
// `500 { ok:false, error:{ kind:"internal" } }` と種類だけの記録で返すことを見る。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeCtx, type Ctx } from "../../../tests/acceptance/v2/_fakes";
import { createHasher } from "../adapters/webcrypto";
import type { Deps, Logger } from "../ports";
import { serveSafely } from "./app";
import { defineRoute } from "./defineRoute";

const ORIGIN = "https://app.test";
/** 例外の文に入っていても、記録には出てはいけない値（個人データのつもり）。 */
const SECRET_IN_MESSAGE = "09012345678";

const recordingLogger = (): Logger & { entries: Array<Record<string, unknown>> } => {
  const entries: Array<Record<string, unknown>> = [];
  return { entries, log: (entry) => entries.push({ ...entry }) };
};

describe("入口が想定外の例外を受け止める", () => {
  it("手続きが投げたら 500・internal の JSON を返し、記録には例外の種類だけを出す", async () => {
    const route = defineRoute({
      method: "GET",
      path: "/api/boom",
      auth: "public",
      handler: async () => {
        throw new TypeError(`壊れた ${SECRET_IN_MESSAGE}`);
      },
    });
    const logger = recordingLogger();
    const res = await route.handle(new Request(`${ORIGIN}/api/boom`), { logger } as unknown as Deps);
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ ok: false, error: { kind: "internal" } });
    expect(logger.entries).toEqual([{ event: "unhandled_error", id: "GET /api/boom", errorKind: "type_error" }]);
    expect(JSON.stringify(logger.entries)).not.toContain(SECRET_IN_MESSAGE);
  });

  it("D1 の落ちは d1_error として記録する（文は出さない）", async () => {
    const route = defineRoute({
      method: "GET",
      path: "/api/boom-db",
      auth: "public",
      handler: async () => {
        throw new Error(`D1_ERROR: UNIQUE constraint failed: customers.phone ${SECRET_IN_MESSAGE}`);
      },
    });
    const logger = recordingLogger();
    const res = await route.handle(new Request(`${ORIGIN}/api/boom-db`), { logger } as unknown as Deps);
    expect(res.status).toBe(500);
    expect(logger.entries).toEqual([{ event: "unhandled_error", id: "GET /api/boom-db", errorKind: "d1_error" }]);
  });

  it("橋（serveSafely）は、Deps を組む所で落ちても 500・internal の JSON を返す（束縛の設定漏れなど）", async () => {
    const logger = recordingLogger();
    const res = await serveSafely(
      new Request(`${ORIGIN}/api/customer/home`),
      () => {
        throw new Error("D1 の束縛 DB が見つかりません");
      },
      logger,
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: { kind: "internal" } });
    expect(logger.entries).toEqual([{ event: "unhandled_error", id: "app", errorKind: "error" }]);
  });
});

describe("ログインの入口で例外が起きても、失敗の回数を数える", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    const real = createHasher();
    // パスワードの計算だけが落ちる（外の事情で例外になった場面の代わり）
    ctx = await makeCtx({ deps: { hasher: { sha256Hex: real.sha256Hex, derive: async () => Promise.reject(new RangeError("derive failed")) } } });
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  it("落ちた要求は 500 で、上限を超えた次の要求は 429 になる（例外で数え上げが飛ばない）", async () => {
    const { LOGIN_FAILURE_LIMIT } = await import("../schemas/limits");
    const body = { email: "locked@example.com", password: "password-1234", humanToken: "tok" };
    for (let i = 0; i < LOGIN_FAILURE_LIMIT; i++) {
      const res = await ctx.api().post("/api/auth/login", body);
      expect(res.status, `${i + 1}回目`).toBe(500);
      expect(res.json).toEqual({ ok: false, error: { kind: "internal" } });
    }
    const locked = await ctx.api().post("/api/auth/login", body);
    expect(locked.status).toBe(429);
    expect((ctx.logger.entries as Array<{ event?: string }>).filter((e) => e.event === "unhandled_error")).toHaveLength(LOGIN_FAILURE_LIMIT);
  });
});
