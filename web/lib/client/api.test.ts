// 応答をスキーマで検査してから返すこと（基準 29.4）。判定記録 docs/specs/v2/audits/task-2-c1.verdict.json の
// F2（応答を検査せず as T でキャストしていた）を固定する。2026-09-25 監査の指摘 設計-07 で、成功の応答も
// 必ず形の表（schemas/responses）で確かめる形に変えた（それまでは形を渡した呼び出しだけで、渡した呼び出しは0か所だった）。
import { afterEach, describe, expect, it } from "vitest";
import { apiCall, apiStream, callApi, isTransientFailure, isUnauthenticated, STREAM_UNAVAILABLE, type ApiFailure } from "./api";
import { onSessionExpired } from "./session";
import { unauthorized } from "../../../tests/acceptance/v2/_fakes";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** 応答を1つだけ返す偽物を置く（外へは出ない）。 */
const respondWith = (status: number, body: unknown): void => {
  globalThis.fetch = (async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })) as typeof fetch;
};

const failureOf = (value: unknown): ApiFailure => {
  expect((value as { ok?: unknown }).ok).toBe(false);
  return value as ApiFailure;
};

describe("client/api が応答の形を確かめてから返す", () => {
  it("入力の断りは例外にせず、項目の一覧も落とさずに返る", async () => {
    respondWith(400, { ok: false, error: { kind: "invalid_input", fields: [{ name: "nickname", reason: "too_long" }] } });
    const failure = failureOf(await apiCall("POST", "/api/register/customer", { nickname: "x" }));
    expect(failure.error?.kind).toBe("invalid_input");
    expect(failure.error?.fields).toEqual([{ name: "nickname", reason: "too_long" }]);
  });

  it("受け取りの断りは refusal と home を削らずに返る", async () => {
    respondWith(409, { ok: false, refusal: { kind: "party_over_max", partyMax: 3, nextStep: "search_again_with_party" }, home: { kind: "fetch" } });
    const failure = failureOf(await apiCall("POST", "/api/customer/reservations", { offerId: "o1" }));
    expect(failure.refusal?.kind).toBe("party_over_max");
    expect(failure.refusal?.partyMax).toBe(3);
    expect(failure.home).toEqual({ kind: "fetch" });
  });

  it("状態による断り（current.state）も返る", async () => {
    respondWith(409, { ok: false, current: { state: "customer_cancelled" } });
    expect(failureOf(await apiCall("POST", "/api/store/reservations/r1/complete")).current?.state).toBe("customer_cancelled");
  });

  it("未ログインの 401 は、入口が返す形のまま断りとして返る（形は受け入れ検査の道具の1か所に揃える）", async () => {
    const { status, json } = unauthorized();
    respondWith(status, json);
    const failure = failureOf(await apiCall("GET", "/api/customer/home"));
    expect(failure).toEqual(json);
  });

  it("アプリの外が返した既定の応答（2xx でなく ok:false も持たない）は kind network に倒す", async () => {
    // アプリ自身の断りは必ず `ok:false` を持つので、ここへ来るのは間に挟まった機器や
    // プラットフォームが返した応答。形だけ見て成功として読むと、画面が中身の無い値で描き出す
    // （2026-09-22 タスク25 が足した。タスク4の監査の指摘 F2）。
    respondWith(502, { message: "Bad gateway" });
    expect(failureOf(await apiCall("GET", "/api/customer/home")).error?.kind).toBe("network");
    respondWith(500, { ok: true });
    expect(failureOf(await apiCall("GET", "/api/customer/home")).error?.kind).toBe("network");
  });

  it("2xx の成功の応答は、形の表に合えば返る（状態コードの検査が成功の道を塞がない）。表に書いていない項目も落とさない", async () => {
    respondWith(201, { ok: true, id: "r1" });
    expect(await apiCall("POST", "/api/customer/reports", { storeId: "s1" })).toEqual({ ok: true, id: "r1" });
  });

  it("約束と違う形の断り（error が物でない）は kind network に倒す", async () => {
    respondWith(400, { ok: false, error: "こわれている" });
    expect(failureOf(await apiCall("POST", "/api/customer/fetch", {})).error?.kind).toBe("network");
  });

  it("JSON でない応答と通信の失敗は kind network", async () => {
    globalThis.fetch = (async () => new Response("<html>", { status: 502 })) as typeof fetch;
    expect(failureOf(await apiCall("GET", "/api/customer/home")).error?.kind).toBe("network");
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    expect(failureOf(await apiCall("GET", "/api/customer/home")).error?.kind).toBe("network");
  });

  it("成功の応答は、入口の形（schemas/responses）で必ず確かめる。合わなければ kind network", async () => {
    respondWith(200, { label: "渋谷駅" });
    expect(await callApi("GET /api/customer/place", { query: { lat: 35.6, lng: 139.7 } })).toEqual({ label: "渋谷駅" });
    respondWith(200, { labels: "渋谷駅" });
    expect(failureOf(await callApi("GET /api/customer/place", { query: { lat: 35.6, lng: 139.7 } })).error?.kind).toBe("network");
    // 項目の名前が変わった客のホーム（kind が無い）は、画面へ渡さない
    respondWith(200, { ok: true, id: "r2" });
    expect(failureOf(await apiCall("GET", "/api/customer/home")).error?.kind).toBe("network");
  });

  it("method と path で呼んでも、path に当たる入口の形で確かめる。表に無い入口は確かめられないので kind network", async () => {
    const home = { kind: "fetch", profile: { nickname: "たなか", phone: "09012345678", genres: [], budgetMax: null } };
    respondWith(200, { ok: true, home });
    expect(await apiCall("POST", "/api/customer/reservations/r1/cancel", {})).toEqual({ ok: true, home });
    respondWith(200, { ok: true });
    expect(failureOf(await apiCall("GET", "/api/no-such-route")).error?.kind).toBe("network");
  });

  it("callApi は動的な区間を percent 符号にして埋め、空の問い合わせは送らない", async () => {
    const paths: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      paths.push(String(input));
      return new Response(JSON.stringify({ items: [], summary: { publishing: 0, pending: 0 } }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    await callApi("GET /api/admin/stores", { query: { filter: "", q: "渋谷 1/2" } });
    await callApi("GET /api/admin/stores", { query: { filter: undefined, q: undefined } });
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      paths.push(String(input));
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    await callApi("DELETE /api/store/coupons/:id", { params: { id: "a/b?c" } });
    expect(paths).toEqual(["/api/admin/stores?q=%E6%B8%8B%E8%B0%B7+1%2F2", "/api/admin/stores", "/api/store/coupons/a%2Fb%3Fc"]);
  });
});

describe("ログインが切れた断りと、取り直せば直るかもしれない失敗（横断-01・設計-15）", () => {
  it("401・unauthenticated は isUnauthenticated が true で、切れた知らせを1回出す", async () => {
    const heard: number[] = [];
    const stop = onSessionExpired(() => heard.push(1));
    respondWith(401, { ok: false, error: { kind: "unauthenticated" } });
    const failure = await apiCall("GET", "/api/store/home");
    stop();
    expect(isUnauthenticated(failure)).toBe(true);
    expect(heard).toHaveLength(1);
  });

  it("ログインの失敗（login_failed）・役割違い（forbidden）は、切れた知らせを出さない", async () => {
    const heard: number[] = [];
    const stop = onSessionExpired(() => heard.push(1));
    respondWith(401, { ok: false, error: { kind: "login_failed" } });
    expect(isUnauthenticated(await apiCall("POST", "/api/auth/login", {}))).toBe(false);
    respondWith(403, { ok: false, error: { kind: "forbidden" } });
    expect(isUnauthenticated(await apiCall("GET", "/api/admin/reports"))).toBe(false);
    stop();
    expect(heard).toHaveLength(0);
  });

  it("サーバーの不具合（internal）は通信の失敗（network）と分けて返り、どちらも取り直せば直るかもしれない失敗", async () => {
    respondWith(500, { ok: false, error: { kind: "internal" } });
    const internal = failureOf(await apiCall("GET", "/api/customer/home"));
    expect(internal.error?.kind).toBe("internal");
    expect(isTransientFailure(internal)).toBe(true);
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;
    expect(isTransientFailure(await apiCall("GET", "/api/customer/home"))).toBe(true);
    respondWith(401, { ok: false, error: { kind: "unauthenticated" } });
    expect(isTransientFailure(await apiCall("GET", "/api/customer/home"))).toBe(false);
  });
});

describe("少しずつ届く応答（NDJSON）を1行ずつ読む", () => {
  /** 少しずつ届く本文を、2回に分けて（行の途中で切って）流す偽物。 */
  const streamWith = (chunks: string[], status = 200): void => {
    globalThis.fetch = (async () => {
      const body = new ReadableStream<Uint8Array>({
        start: (controller) => {
          const encoder = new TextEncoder();
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      });
      return new Response(body, { status, headers: { "content-type": "application/x-ndjson" } });
    }) as typeof fetch;
  };

  it("行の途中で切れて届いても、つなぎ直して1行ずつ渡す", async () => {
    streamWith(['{"type":"init","fetchId":"f1","items":[]}\n{"type":"pi', 'tch","storeId":"s1","reason":"刺身が自慢です","source":"persona"}\n{"type":"done"}\n']);
    const lines: Array<Record<string, unknown>> = [];
    const outcome = await apiStream("/api/customer/fetch/stream", { party: 2 }, (line) => lines.push(line));
    expect(outcome).toBeNull();
    expect(lines.map((l) => l.type)).toEqual(["init", "pitch", "done"]);
    expect(lines[1].reason).toBe("刺身が自慢です");
  });

  it("壊れた行は捨てて、後ろの行は届く。最後の改行が無くても読む", async () => {
    streamWith(['{"type":"init","fetchId":"f1","items":[]}\nこれは JSON ではない\n{"type":"done"}']);
    const lines: Array<Record<string, unknown>> = [];
    await apiStream("/api/customer/fetch/stream", {}, (line) => lines.push(line));
    expect(lines.map((l) => l.type)).toEqual(["init", "done"]);
  });

  it("形（schemas/responses の STREAM_LINE）に合わない行は捨てる（設計-07）", async () => {
    streamWith(['{"type":"init","items":[]}\n{"type":"pitch","storeId":"s1","reason":"文","source":"persona"}\n{"type":"unknown"}\n{"type":"done"}\n']);
    const lines: Array<Record<string, unknown>> = [];
    await apiStream("/api/customer/fetch/stream", {}, (line) => lines.push(line));
    expect(lines.map((l) => l.type)).toEqual(["pitch", "done"]);
  });

  it("経路が無い（404）なら、呼ぶ側が普通の入口へ倒せる合図を返す", async () => {
    respondWith(404, { ok: false, error: { kind: "not_found" } });
    expect(await apiStream("/api/customer/fetch/stream", {}, () => {})).toBe(STREAM_UNAVAILABLE);
  });

  it("断り（400）は普通の入口と同じ形で返る", async () => {
    respondWith(400, { ok: false, error: { kind: "invalid_input", fields: [{ name: "party", reason: "required" }] } });
    const outcome = await apiStream("/api/customer/fetch/stream", {}, () => {});
    expect(outcome).toMatchObject({ ok: false, error: { kind: "invalid_input" } });
  });

  it("通信そのものが失敗したら、通信の失敗として返る", async () => {
    globalThis.fetch = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    expect(await apiStream("/api/customer/fetch/stream", {}, () => {})).toEqual({ ok: false, error: { kind: "network" } });
  });
});
