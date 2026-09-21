// 壊れた値でシステムが落ちないこと（要件29）。判定記録 docs/specs/v2/audits/task-2-c1.verdict.json の
// F1（URL のパス区間・Cookie ヘッダー・multipart 本文が壊れていると例外が誰にも捕まらない）を固定する。
import { afterEach, describe, expect, it } from "vitest";
import type { Deps } from "../ports";
import { createApp } from "./app";
import { parseCookies } from "./cookies";
import { defineRoute, type RouteDefinition } from "./defineRoute";
import { ROUTE_DEFINITIONS } from "./routes";

const ORIGIN = "https://app.test";
/** 途中で切れた percent 符号。decodeURIComponent が URIError を投げる形。 */
const BROKEN_PERCENT = "%E0%A4%A";

const echoRoute = defineRoute({
  method: "GET",
  path: "/api/echo/:id",
  auth: "public",
  handler: async ({ params }) => ({ status: 200, body: { ok: true, id: params.id } }),
});

const uploadRoute = defineRoute({
  method: "POST",
  path: "/api/upload",
  auth: "public",
  handler: async ({ input }) => ({ status: 200, body: { ok: true, input } }),
});

// ROUTE_DEFINITIONS は「各タスクが自分の入口を足す」置き場（routes.ts の注）なので、
// この検査も同じやり方で試しの入口を足し、毎回空に戻す。
const useRoutes = (...routes: RouteDefinition[]): void => {
  ROUTE_DEFINITIONS.push(...routes);
};
afterEach(() => {
  ROUTE_DEFINITIONS.length = 0;
});

/** この検査が通る道は deps に触らない（入口に当たる前・本文を読む所で終わる）。 */
const noDeps = {} as Deps;

describe("壊れた URL・Cookie・本文で落ちない", () => {
  it("パスの動的な区間が壊れた percent 符号なら、例外を投げずに 404 になる", async () => {
    useRoutes(echoRoute);
    const res = await createApp(noDeps).fetch(new Request(`${ORIGIN}/api/echo/${BROKEN_PERCENT}`));
    expect(res.status).toBe(404);
  });

  it("読める区間はそのまま通る（404 に倒すのは壊れたときだけ）", async () => {
    useRoutes(echoRoute);
    const res = await createApp(noDeps).fetch(new Request(`${ORIGIN}/api/echo/%E3%81%82`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: "あ" });
  });

  it("Cookie の値が壊れていても、その1つを読み飛ばして残りは読める", () => {
    const cookies = parseCookies(`aihack_customer=${BROKEN_PERCENT}; other=fine`);
    expect(cookies.aihack_customer).toBeUndefined();
    expect(cookies.other).toBe("fine");
  });

  it("multipart の本文が壊れていたら、例外ではなく入力の断り（400）になる", async () => {
    const req = new Request(`${ORIGIN}/api/upload`, {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=----X", origin: ORIGIN },
      body: "multipart になっていない本文",
    });
    const res = await uploadRoute.handle(req, noDeps);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: { kind: string; fields: Array<{ name: string; reason: string }> } };
    expect(body.ok).toBe(false);
    expect(body.error.kind).toBe("invalid_input");
    expect(body.error.fields.length).toBeGreaterThan(0);
  });
});
