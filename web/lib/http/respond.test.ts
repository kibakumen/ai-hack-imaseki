// 入口が成功を返すときに、応答の形の表（schemas/responses）で確かめること（監査の指摘 設計-07・2026-09-25）。
// サーバーと画面が同じ定義を使うので、項目の名前を変えたのに片方だけ直った、が型検査と検査で捕まる。
import { describe, expect, it } from "vitest";
import type { Deps, Logger } from "../ports";
import { defineRoute } from "./defineRoute";
import { respond, ResponseShapeError } from "./respond";

const ORIGIN = "https://app.test";

describe("respond（成功の応答を形の表で確かめてから返す）", () => {
  it("形に合う本文は、そのまま状態コードつきで返す", () => {
    expect(respond("GET /api/customer/place", { label: "渋谷駅" })).toEqual({ status: 200, body: { label: "渋谷駅" } });
    expect(respond("POST /api/customer/reports", { ok: true }, 201)).toEqual({ status: 201, body: { ok: true } });
  });

  it("形に合わない本文は、応答の形の崩れとして投げる（どの入口かを持つ）", () => {
    const broken = { labels: "渋谷駅" } as unknown as { label: string | null };
    expect(() => respond("GET /api/customer/place", broken)).toThrow(ResponseShapeError);
  });

  it("入口の中で形が崩れたら、500・internal と response_shape_error の記録になる（崩れた本文を画面へ渡さない）", async () => {
    const route = defineRoute({
      method: "GET",
      path: "/api/customer/place",
      auth: "public",
      handler: async () => respond("GET /api/customer/place", { label: 1 } as unknown as { label: string | null }),
    });
    const entries: Array<Record<string, unknown>> = [];
    const logger: Logger = { log: (entry) => entries.push({ ...entry }) };
    const res = await route.handle(new Request(`${ORIGIN}/api/customer/place`), { logger } as unknown as Deps);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: { kind: "internal" } });
    expect(entries).toEqual([{ event: "unhandled_error", id: "GET /api/customer/place", errorKind: "response_shape_error" }]);
  });
});
