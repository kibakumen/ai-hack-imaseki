// セッションの見分けと、使われるたびの延長（要件14）。受け入れ検査が触れない2つの道を固定する:
// ①期限の値が壊れているときに「切れている」側へ倒すこと（フェイルクローズ・本人選択 2026-09-21）
// ②残りが半分を切ったときだけ延ばすこと（スライディングウィンドウ・同）。
import { describe, expect, it } from "vitest";
import type { Deps } from "../ports";
import { SESSION_MAX_AGE_SECONDS } from "../schemas/limits";
import { identifySession, renewSession } from "./guards";
import { defineRoute } from "./defineRoute";

const NOW = new Date("2026-09-22T06:00:00.000Z");
const ORIGIN = "https://app.test";
const TOKEN = "session-token";
/** guards は Cookie の値を SHA-256 にして探す。偽の Hasher は同じ値へ決まった形で写す。 */
const hashOf = (value: string) => `sha256(${value})`;

type Ran = { sql: string; args: unknown[] };

const fakeDeps = (row: Record<string, unknown> | null) => {
  const ran: Ran[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => row,
        run: async () => {
          ran.push({ sql, args });
          return { success: true };
        },
      }),
    }),
  };
  const deps = {
    db,
    hasher: { sha256Hex: async (value: string) => hashOf(value), derive: async () => "" },
    clock: { now: () => NOW, after: async () => {} },
  } as unknown as Deps;
  return { deps, ran };
};

const sessionRow = (expiresAt: unknown, over: Record<string, unknown> = {}) => ({
  expires_at: expiresAt,
  account_id: "account-1",
  role: "store",
  store_id: "store-1",
  must_change_password: 0,
  ...over,
});

const requestWithCookie = () => new Request(`${ORIGIN}/api/store/home`, { headers: { cookie: `aihack_session=${TOKEN}` } });

const minutesFromNow = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000).toISOString();

describe("セッションの見分け", () => {
  it("期限が先なら、持ち主の役割と店の番号が返る", async () => {
    const { deps } = fakeDeps(sessionRow(minutesFromNow(90)));
    const session = await identifySession(requestWithCookie(), deps);
    expect(session).toMatchObject({ accountId: "account-1", role: "store", storeId: "store-1", tokenHash: hashOf(TOKEN) });
  });

  it("期限が過ぎていれば null", async () => {
    const { deps } = fakeDeps(sessionRow(minutesFromNow(-1)));
    expect(await identifySession(requestWithCookie(), deps)).toBeNull();
  });

  it("期限の値が日付として読めなければ、期限切れとして断る（フェイルクローズ）", async () => {
    for (const broken of ["", "きのう", "2026-13-45T99:99:99Z", null, 0]) {
      const { deps } = fakeDeps(sessionRow(broken));
      expect(await identifySession(requestWithCookie(), deps), String(broken)).toBeNull();
    }
  });

  it("Cookie が無ければ表を引かずに null", async () => {
    const { deps } = fakeDeps(sessionRow(minutesFromNow(90)));
    expect(await identifySession(new Request(`${ORIGIN}/api/store/home`), deps)).toBeNull();
  });
});

describe("使われるたびの延長", () => {
  it("残りが半分より多ければ、表も Cookie も動かさない", async () => {
    const { deps, ran } = fakeDeps(sessionRow(minutesFromNow(90)));
    const session = (await identifySession(requestWithCookie(), deps))!;
    expect(await renewSession(deps, session)).toEqual([]);
    expect(ran).toEqual([]);
  });

  it("残りが半分を切っていれば、表の期限を今から2時間先へ動かし、同じ長さの Set-Cookie を返す", async () => {
    const { deps, ran } = fakeDeps(sessionRow(minutesFromNow(30)));
    const session = (await identifySession(requestWithCookie(), deps))!;
    const cookies = await renewSession(deps, session);
    expect(ran).toHaveLength(1);
    expect(ran[0].sql).toMatch(/UPDATE sessions/);
    expect(ran[0].args).toEqual([hashOf(TOKEN), new Date(NOW.getTime() + SESSION_MAX_AGE_SECONDS * 1000).toISOString()]);
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain(`aihack_session=${TOKEN}`);
    expect(cookies[0]).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);
    expect(cookies[0]).toMatch(/HttpOnly/);
  });
});

describe("店の入口の見分け", () => {
  const route = defineRoute({
    method: "GET",
    path: "/api/store/home",
    auth: "store",
    handler: async ({ ctx }) => ({ status: 200, body: { storeId: ctx.storeId } }),
  });

  it("役割が店で店の番号が在れば通る", async () => {
    const { deps } = fakeDeps(sessionRow(minutesFromNow(90)));
    const res = await route.handle(requestWithCookie(), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ storeId: "store-1" });
  });

  it("役割が店なのに店の番号が無ければ、空の文字列へ倒さずに 403 で断る", async () => {
    const { deps } = fakeDeps(sessionRow(minutesFromNow(90), { store_id: null }));
    const res = await route.handle(requestWithCookie(), deps);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: { kind: "invalid_input" } });
  });
});
