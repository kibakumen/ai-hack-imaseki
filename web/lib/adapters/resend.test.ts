// メールを送る口の実物（受け入れ検査はこの口を持たないので、ここだけが実物の振る舞いを見る）。
// 見るのは3つ: 送れたとき／Resend が断ったとき／通信が失敗したとき。turnstile.test.ts に倣う。
import { describe, expect, it } from "vitest";
import { createMailer } from "./resend";

describe("adapters/resend", () => {
  it("2xx なら送れた。鍵は Bearer で、送信元・宛先・題・本文を JSON で Resend へ送る", async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: unknown; signal: AbortSignal | null | undefined }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)), signal: init.signal });
      return new Response(JSON.stringify({ id: "msg_1" }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof globalThis.fetch;
    const controller = new AbortController();
    const mailer = createMailer({ apiKey: "re_key", from: "AkI席 <noreply@example.com>", fetch: fetchImpl });
    const result = await mailer.send({ to: "store@example.com", subject: "件名", text: "本文" }, { signal: controller.signal });
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].headers.authorization).toBe("Bearer re_key");
    expect(calls[0].body).toEqual({ from: "AkI席 <noreply@example.com>", to: ["store@example.com"], subject: "件名", text: "本文" });
    expect(calls[0].signal).toBe(controller.signal);
  });

  it("2xx でなければ送れなかった（断りの本文は持ち歩かない）", async () => {
    const forbidden = (async () => new Response(JSON.stringify({ message: "domain is not verified" }), { status: 403 })) as unknown as typeof globalThis.fetch;
    expect(await createMailer({ apiKey: "k", from: "a@example.com", fetch: forbidden }).send({ to: "b@example.com", subject: "s", text: "t" }, {})).toEqual({ ok: false });
  });

  it("通信が失敗しても投げず、送れなかったと答える", async () => {
    const throws = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof globalThis.fetch;
    expect(await createMailer({ apiKey: "k", from: "a@example.com", fetch: throws }).send({ to: "b@example.com", subject: "s", text: "t" }, {})).toEqual({ ok: false });
  });
});
