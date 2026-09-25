// 要求の本文の大きさの上限（2026-09-25 監査の指摘 安全-13）。
// 以前は本文を丸ごと読んでから JSON にしていて、大きさを1度も見ていなかった。本文を読むのは抑止と
// 人かどうかの確かめより前なので、誰でも（ログインなしで）ログインの入口へ数十MBを送れた。
// 上限は defineRoute の設定（既定16KB）で、読む前に content-length を見て、無ければ読みながら数えて打ち切る。
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Deps } from "../ports";
import { DEFAULT_MAX_BODY_BYTES, MENUS_INPUT_MAX } from "../schemas/limits";
import { storeProfileSchema } from "../schemas/store";
import { defineRoute } from "./defineRoute";

const ORIGIN = "https://app.test";
const deps = { clock: { now: () => new Date("2026-09-22T06:00:00.000Z"), after: () => new Promise<void>(() => {}) } } as unknown as Deps;

const echoRoute = (onHandled: () => void, maxBodyBytes?: number) =>
  defineRoute({
    method: "POST",
    path: "/api/test/echo",
    auth: "public",
    input: z.object({ text: z.string() }),
    ...(maxBodyBytes === undefined ? {} : { maxBodyBytes }),
    handler: async ({ input }) => {
      onHandled();
      return { status: 200, body: { ok: true, length: input.text.length } };
    },
  });

const jsonRequest = (body: string, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}/api/test/echo`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, ...headers }, body });

/** content-length を名乗らずに、少しずつ届く本文（chunked）。読んだ量を数える。 */
const streamedRequest = (totalBytes: number, chunkBytes = 4096) => {
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull: (controller) => {
      if (sent >= totalBytes) {
        controller.close();
        return;
      }
      const size = Math.min(chunkBytes, totalBytes - sent);
      sent += size;
      controller.enqueue(new Uint8Array(size).fill(0x61));
    },
  });
  const req = new Request(`${ORIGIN}/api/test/echo`, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body: stream, duplex: "half" } as RequestInit);
  return { req, sentBytes: () => sent };
};

describe("本文の大きさの上限（安全-13）", () => {
  it("上限の中の本文は読んで手続きへ渡す", async () => {
    let handled = 0;
    const res = await echoRoute(() => handled++).handle(jsonRequest(JSON.stringify({ text: "あ".repeat(100) })), deps);
    expect(res.status).toBe(200);
    expect(handled).toBe(1);
  });

  it("名乗った大きさ（content-length）が既定の16KBを超えれば、読まずに 413 body_too_large で断り、手続きは動かない", async () => {
    let handled = 0;
    const body = JSON.stringify({ text: "a".repeat(DEFAULT_MAX_BODY_BYTES + 1) });
    const res = await echoRoute(() => handled++).handle(jsonRequest(body, { "content-length": String(body.length) }), deps);
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { kind: string } }).error.kind).toBe("body_too_large");
    expect(handled).toBe(0);
  });

  it("大きさを名乗らない本文も、読みながら数えて上限で打ち切る（全部は読まない）", async () => {
    let handled = 0;
    const { req, sentBytes } = streamedRequest(10 * 1024 * 1024);
    const res = await echoRoute(() => handled++).handle(req, deps);
    expect(res.status).toBe(413);
    expect(handled).toBe(0);
    expect(sentBytes()).toBeLessThan(DEFAULT_MAX_BODY_BYTES * 4);
  });

  it("入口ごとに上限を広げられる（営業許可書の入口のため）", async () => {
    let handled = 0;
    const body = JSON.stringify({ text: "a".repeat(DEFAULT_MAX_BODY_BYTES * 2) });
    const res = await echoRoute(() => handled++, DEFAULT_MAX_BODY_BYTES * 4).handle(jsonRequest(body), deps);
    expect(res.status).toBe(200);
    expect(handled).toBe(1);
  });

  it("営業許可書の入口（POST /api/store/license）の上限は、10MB のファイルが multipart の包みごと入る大きさ", async () => {
    const { ROUTE_DEFINITIONS } = await import("./routes");
    const { LICENSE_MAX_BYTES } = await import("../schemas/limits");
    const license = ROUTE_DEFINITIONS.find((r) => r.method === "POST" && r.path === "/api/store/license")!;
    expect(license.maxBodyBytes).toBeGreaterThan(LICENSE_MAX_BYTES);
    const others = ROUTE_DEFINITIONS.filter((r) => r !== license && r.method !== "GET");
    for (const r of others) expect(r.maxBodyBytes, `${r.method} ${r.path}`).toBe(DEFAULT_MAX_BODY_BYTES);
  });

  it("おすすめメニューの並びにも緩い上限がある（件数の上限の規則の断り too_many は手続きが返すので、それより広い）", () => {
    const base = { name: "店", address: "東京都", url: null, genres: ["和食"], budgetMin: 0, budgetMax: 1000 };
    expect(storeProfileSchema.safeParse({ ...base, menus: Array.from({ length: MENUS_INPUT_MAX }, () => "a") }).success).toBe(true);
    expect(storeProfileSchema.safeParse({ ...base, menus: Array.from({ length: MENUS_INPUT_MAX + 1 }, () => "a") }).success).toBe(false);
  });
});
