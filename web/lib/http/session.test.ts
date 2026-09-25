// セッションの見分けと、使われるたびの延長（要件14）。受け入れ検査が触れない2つの道を固定する:
// ①期限の値が壊れているときに「切れている」側へ倒すこと（フェイルクローズ・本人選択 2026-09-21）
// ②残りが1時間（SESSION_RENEW_WITHIN_SECONDS）を切ったときだけ延ばすこと（スライディングウィンドウ・同）。
// ③作った時刻から14日（SESSION_ABSOLUTE_MAX_SECONDS）で必ず切れ、延ばす先もそれを越えないこと（安全-08）。
import { describe, expect, it } from "vitest";
import type { Deps } from "../ports";
import { SESSION_ABSOLUTE_MAX_SECONDS, SESSION_MAX_AGE_SECONDS } from "../schemas/limits";
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
  // 既定は1時間前に作ったセッション（絶対の寿命の内）
  created_at: new Date(NOW.getTime() - 60 * 60_000).toISOString(),
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

  it("作った時刻から絶対の寿命（14日）を過ぎていれば、期限の内でも null", async () => {
    const created = new Date(NOW.getTime() - SESSION_ABSOLUTE_MAX_SECONDS * 1000).toISOString();
    const { deps } = fakeDeps(sessionRow(minutesFromNow(90), { created_at: created }));
    expect(await identifySession(requestWithCookie(), deps)).toBeNull();
    const justInside = new Date(NOW.getTime() - SESSION_ABSOLUTE_MAX_SECONDS * 1000 + 1000).toISOString();
    expect(await identifySession(requestWithCookie(), fakeDeps(sessionRow(minutesFromNow(90), { created_at: justInside })).deps)).not.toBeNull();
  });

  it("作った時刻が無い・読めない行（0008 より前の行・壊れた値）は、切れたものとして断る（フェイルクローズ）", async () => {
    for (const broken of [null, "", "きのう"]) {
      const { deps } = fakeDeps(sessionRow(minutesFromNow(90), { created_at: broken }));
      expect(await identifySession(requestWithCookie(), deps), String(broken)).toBeNull();
    }
  });

  it("Cookie が無ければ表を引かずに null", async () => {
    const { deps } = fakeDeps(sessionRow(minutesFromNow(90)));
    expect(await identifySession(new Request(`${ORIGIN}/api/store/home`), deps)).toBeNull();
  });
});

describe("使われるたびの延長", () => {
  it("残りが延長の窓（1時間）より多く残っていれば、表も Cookie も動かさない", async () => {
    const { deps, ran } = fakeDeps(sessionRow(minutesFromNow(90)));
    const session = (await identifySession(requestWithCookie(), deps))!;
    expect(await renewSession(deps, session)).toEqual([]);
    expect(ran).toEqual([]);
  });

  it("残りが1時間を切っていれば、表の期限を今から25時間先へ動かし、同じ長さの Set-Cookie を返す", async () => {
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

  it("延ばす先は絶対の寿命の終わりを越えない（Cookie の Max-Age もそこまで）", async () => {
    // 作ってから13日と23時間たったセッション: 寿命の終わりまで残り1時間
    const created = new Date(NOW.getTime() - SESSION_ABSOLUTE_MAX_SECONDS * 1000 + 60 * 60_000);
    const { deps, ran } = fakeDeps(sessionRow(minutesFromNow(30), { created_at: created.toISOString() }));
    const session = (await identifySession(requestWithCookie(), deps))!;
    const cookies = await renewSession(deps, session);
    expect(ran[0].args).toEqual([hashOf(TOKEN), new Date(created.getTime() + SESSION_ABSOLUTE_MAX_SECONDS * 1000).toISOString()]);
    expect(cookies[0]).toContain(`Max-Age=${60 * 60}`);
  });

  it("寿命の終わりが今の期限より手前なら、延ばさない（表も Cookie も触らない）", async () => {
    const created = new Date(NOW.getTime() - SESSION_ABSOLUTE_MAX_SECONDS * 1000 + 20 * 60_000);
    const { deps, ran } = fakeDeps(sessionRow(minutesFromNow(30), { created_at: created.toISOString() }));
    const session = (await identifySession(requestWithCookie(), deps))!;
    expect(await renewSession(deps, session)).toEqual([]);
    expect(ran).toEqual([]);
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
    expect(await res.json()).toEqual({ ok: false, error: { kind: "forbidden" } });
  });
});
