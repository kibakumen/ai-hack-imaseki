// 応答をスキーマで検査してから返すこと（基準 29.4）。判定記録 docs/specs/v2/audits/task-2-c1.verdict.json の
// F2（応答を検査せず as T でキャストしていた）を固定する。
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { apiCall, apiStream, STREAM_UNAVAILABLE, type ApiFailure } from "./api";

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

  it("アプリの外が返した既定の応答（2xx でなく ok:false も持たない）は kind network に倒す", async () => {
    // アプリ自身の断りは必ず `ok:false` を持つので、ここへ来るのは間に挟まった機器や
    // プラットフォームが返した応答。形だけ見て成功として読むと、画面が中身の無い値で描き出す
    // （2026-09-22 タスク25 が足した。タスク4の監査の指摘 F2）。
    respondWith(502, { message: "Bad gateway" });
    expect(failureOf(await apiCall<Ok>("GET", "/api/customer/home")).error?.kind).toBe("network");
    respondWith(500, { ok: true });
    expect(failureOf(await apiCall<Ok>("GET", "/api/customer/home")).error?.kind).toBe("network");
  });

  it("2xx の応答は、形を渡さなければそのまま返る（状態コードの検査が成功の道を塞がない）", async () => {
    respondWith(201, { ok: true, id: "r1" });
    expect(await apiCall<Ok>("POST", "/api/customer/reports", { storeId: "s1" })).toEqual({ ok: true, id: "r1" });
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
    streamWith(['{"type":"init","fetchId":"f1","items":[]}\n{"type":"pi', 'tch","storeId":"s1","reason":"刺身が自慢です"}\n{"type":"done"}\n']);
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
