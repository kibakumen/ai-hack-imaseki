// 人かどうかの確かめの入口の側（2026-09-25 監査の指摘 安全-23）。
//
// 実物の確かめ（adapters/turnstile）が答えの場所と用途を見るには、入口がそれを渡さなければならない。
// 3つの入口（ログイン・店の登録・客の登録）が、それぞれの用途と、要求の来たホスト名と、接続元を渡すことを見る。
// 画面の部品が同じ用途を Turnstile に名乗ることは components/ui/HumanCheck.test.tsx が見る。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CUSTOMER, makeCtx, STORE_TERMS_AGREEMENT, type Ctx } from "../../tests/acceptance/v2/_fakes";
import { ROUTE_DEFINITIONS } from "../lib/http/routes";
import type { HumanCheck, HumanCheckOptions } from "../lib/ports";
import { HUMAN_CHECK_ACTIONS } from "../lib/schemas/limits";

let ctx: Ctx;

beforeAll(async () => {
  ctx = await makeCtx();
});

afterAll(async () => {
  await ctx.dispose();
});

/** 渡された期待を控えて、人と答える確かめ */
const recordingHuman = () => {
  const seen: Array<Omit<HumanCheckOptions, "signal">> = [];
  const human: HumanCheck = {
    verify: async (_token, opts) => {
      seen.push({ expectedAction: opts.expectedAction, expectedHostname: opts.expectedHostname, remoteIp: opts.remoteIp });
      return { ok: true, human: true };
    },
  };
  return { seen, human };
};

describe("入口が確かめに渡す期待（安全-23）", () => {
  it("ログイン・店の登録・客の登録が、それぞれの用途と、要求の来たホスト名と、接続元を渡す", async () => {
    const { seen, human } = recordingHuman();
    const next = await ctx.withDeps({ human });
    const api = next.api(null, { ip: "203.0.113.9" });
    await api.post("/api/register/store", { name: "確かめの店", email: "hc-store@example.com", password: "store-pass-1234", humanToken: "tok-ok", ...STORE_TERMS_AGREEMENT });
    await api.post("/api/register/customer", { ...CUSTOMER, humanToken: "tok-ok" });
    await api.post("/api/auth/login", { email: "hc-store@example.com", password: "store-pass-1234", humanToken: "tok-ok" });
    expect(seen).toEqual([
      { expectedAction: HUMAN_CHECK_ACTIONS.registerStore, expectedHostname: "app.test", remoteIp: "203.0.113.9" },
      { expectedAction: HUMAN_CHECK_ACTIONS.registerCustomer, expectedHostname: "app.test", remoteIp: "203.0.113.9" },
      { expectedAction: HUMAN_CHECK_ACTIONS.login, expectedHostname: "app.test", remoteIp: "203.0.113.9" },
    ]);
  });

  it("確かめつきの入口は全部、用途を名乗っていて、用途は入口ごとに別", () => {
    const humanRoutes = ROUTE_DEFINITIONS.filter((r) => r.human);
    expect(humanRoutes.map((r) => `${r.method} ${r.path}`).sort()).toEqual(["POST /api/auth/login", "POST /api/register/customer", "POST /api/register/store"]);
    const actions = humanRoutes.map((r) => r.humanAction);
    expect(actions.every((a) => a !== null)).toBe(true);
    expect(new Set(actions).size).toBe(actions.length);
  });
});
