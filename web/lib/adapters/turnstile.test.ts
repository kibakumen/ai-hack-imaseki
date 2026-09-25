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
      // 本物の応答と同じく、どのホスト名・どの用途で解かれたかも返る
      return jsonResponse({ success: true, hostname: "app.test", action: "login" });
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

  // どのホスト名で解かれたか分からない答えは、人と認めない（以前の検査は hostname の無い応答を「人」として固めていた・設計-04）。
  // 2026-09-25 に安全-23 を直したので、普通の it に戻した。
  it("安全-23 応答に hostname が無い（どこで解かれたか分からない）ときは、人と認めない", async () => {
    const fetchImpl = (async () => jsonResponse({ success: true })) as unknown as typeof globalThis.fetch;
    expect(await createHumanCheck({ secretKey: "s", fetch: fetchImpl }).verify("tok", {})).not.toEqual({ ok: true, human: true });
  });

  // 安全-23: 本番のサイトキーを自前の localhost のページに置いて解いた値を、本番の登録やログインに流せた。
  // 解かれたホスト名が要求の来たホスト名と合うか、用途（action）が入口の用途と合うかを見る。
  describe("解かれた場所と用途の確かめ（安全-23）", () => {
    const answering = (body: unknown) => {
      const bodies: string[] = [];
      const fetchImpl = (async (_url: string, init: RequestInit) => {
        bodies.push(String(init.body));
        return jsonResponse(body);
      }) as unknown as typeof globalThis.fetch;
      return { bodies, human: createHumanCheck({ secretKey: "secret-key", fetch: fetchImpl }) };
    };
    const expected = { expectedHostname: "app.test", expectedAction: "login" };

    it("ホスト名も用途も合えば人", async () => {
      const { human } = answering({ success: true, hostname: "app.test", action: "login" });
      expect(await human.verify("tok", expected)).toEqual({ ok: true, human: true });
    });

    it("別のホスト名（localhost など）で解かれた値は、人と認めない", async () => {
      const { human } = answering({ success: true, hostname: "localhost", action: "login" });
      expect(await human.verify("tok", expected)).toEqual({ ok: true, human: false });
    });

    it("別の用途（登録の部品で解いた値をログインに流す等）は、人と認めない。用途の無い答えも同じ", async () => {
      expect(await answering({ success: true, hostname: "app.test", action: "register-store" }).human.verify("tok", expected)).toEqual({ ok: true, human: false });
      expect(await answering({ success: true, hostname: "app.test" }).human.verify("tok", expected)).toEqual({ ok: true, human: false });
    });

    it("ホスト名は大小を区別せずに比べる", async () => {
      const { human } = answering({ success: true, hostname: "APP.test", action: "login" });
      expect(await human.verify("tok", expected)).toEqual({ ok: true, human: true });
    });

    it("接続元が渡されれば remoteip として Cloudflare へ送る。無ければ送らない", async () => {
      const withIp = answering({ success: true, hostname: "app.test", action: "login" });
      await withIp.human.verify("tok", { ...expected, remoteIp: "203.0.113.5" });
      expect(new URLSearchParams(withIp.bodies[0]).get("remoteip")).toBe("203.0.113.5");
      const withoutIp = answering({ success: true, hostname: "app.test", action: "login" });
      await withoutIp.human.verify("tok", { ...expected, remoteIp: null });
      expect(new URLSearchParams(withoutIp.bodies[0]).has("remoteip")).toBe(false);
    });

    it("Cloudflare の試験用の秘密鍵（手元の開発用）では、決まった値（localhost・test）が返るので、ホスト名と用途を見ない", async () => {
      const fetchImpl = (async () => jsonResponse({ success: true, hostname: "localhost", action: "test" })) as unknown as typeof globalThis.fetch;
      const human = createHumanCheck({ secretKey: "1x0000000000000000000000000000000AA", fetch: fetchImpl });
      expect(await human.verify("XXXX.DUMMY.TOKEN.XXXX", { expectedHostname: "127.0.0.1", expectedAction: "login" })).toEqual({ ok: true, human: true });
    });
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
