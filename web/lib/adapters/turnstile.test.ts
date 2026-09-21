// 人かどうかの確かめの実物（受け入れ検査は偽物に差し替えるので、ここだけが実物の振る舞いを見る）。
// 見るのは4つ: 値が無いとき／人のとき／人でないとき／外が答えなかったとき。
import { describe, expect, it, vi } from "vitest";
import { createHumanCheck } from "./turnstile";

const jsonResponse = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("adapters/turnstile", () => {
  it("確かめの値が無ければ、外へ聞かずに人でないと答える", async () => {
    const fetchImpl = vi.fn();
    const human = createHumanCheck({ secretKey: "secret", fetch: fetchImpl as unknown as typeof globalThis.fetch });
    expect(await human.verify(null, {})).toEqual({ ok: true, human: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("success が true なら人。秘密鍵と受け取った値を Cloudflare へ送る", async () => {
    const calls: Array<{ url: string; body: string; signal: AbortSignal | null | undefined }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: String(init.body), signal: init.signal });
      return jsonResponse({ success: true });
    }) as unknown as typeof globalThis.fetch;
    const controller = new AbortController();
    const human = createHumanCheck({ secretKey: "secret-key", fetch: fetchImpl });
    expect(await human.verify("tok-1", { signal: controller.signal })).toEqual({ ok: true, human: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("challenges.cloudflare.com");
    expect(calls[0].body).toContain("secret=secret-key");
    expect(calls[0].body).toContain("response=tok-1");
    expect(calls[0].signal).toBe(controller.signal);
  });

  it("success が false なら人でない（確かめ自体は済んでいる）", async () => {
    const fetchImpl = (async () => jsonResponse({ success: false, "error-codes": ["invalid-input-response"] })) as unknown as typeof globalThis.fetch;
    expect(await createHumanCheck({ secretKey: "s", fetch: fetchImpl }).verify("tok", {})).toEqual({ ok: true, human: false });
  });

  it("状態が 200 でない・JSON でない・通信が失敗したときは、確かめられなかったと答える", async () => {
    const errorResponse = (async () => new Response("bad gateway", { status: 502 })) as unknown as typeof globalThis.fetch;
    expect(await createHumanCheck({ secretKey: "s", fetch: errorResponse }).verify("tok", {})).toEqual({ ok: false });

    const notJson = (async () => new Response("<html>", { status: 200 })) as unknown as typeof globalThis.fetch;
    expect(await createHumanCheck({ secretKey: "s", fetch: notJson }).verify("tok", {})).toEqual({ ok: false });

    const throws = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof globalThis.fetch;
    expect(await createHumanCheck({ secretKey: "s", fetch: throws }).verify("tok", {})).toEqual({ ok: false });
  });
});
