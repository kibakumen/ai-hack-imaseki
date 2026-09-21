// 少しずつ届ける取得（NDJSON）。店の選定は偽の口で済ませ、行の並びと打ち止めだけを見る。
import { describe, expect, it, vi } from "vitest";
import type { Deps, PitchResult } from "../ports";

const SELECTION = JSON.stringify({ selections: [{ storeId: "store-1", reason: "近くて好みに合います" }] });

/** 取得の手続きを偽物にして、この層（配信）だけを見る */
vi.mock("./fetchOffers", () => ({
  fetchOffers: async () => ({
    ok: true,
    fetchId: "fetch-1",
    items: [{ offerId: "offer-1", storeId: "store-1", storeName: "海鮮どんぶり亭", walkMinutes: 3, budgetMin: 2000, budgetMax: 4000, reason: "近くて好みに合います", partyMax: 4, coupons: [], storeUrl: null }],
    pitchTargets: [
      {
        storeId: "store-1",
        store: { name: "海鮮どんぶり亭", genres: ["和食"], menus: ["刺身盛り"], walkMinutes: 3, budgetMin: 2000, budgetMax: 4000, couponName: null, couponNote: null },
        selectionReason: "近くて好みに合います",
      },
    ],
  }),
}));

const { buildOffersStream } = await import("./streamOffers");

const ok = (text: string): PitchResult => ({ ok: true, text, costUsd: 0.0001, truncated: false });

const makeDeps = (pitch: Deps["pitch"]): Deps =>
  ({
    db: { prepare: () => ({ bind: () => ({ run: async () => {} }) }), batch: async () => [] },
    pitch,
    logger: { log: () => {} },
    // 打ち切りの合図は鳴らさない（この検査で見たいのは行の並びで、時間切れの筋ではない）
    clock: { now: () => new Date("2026-09-22T06:00:00.000Z"), after: () => new Promise<void>(() => {}) },
    rng: { bytes: (n: number) => new Uint8Array(n).fill(3) },
  }) as unknown as Deps;

const readLines = async (stream: ReadableStream<Uint8Array>): Promise<Array<Record<string, unknown>>> => {
  const text = await new Response(stream).text();
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
};

describe("少しずつ届ける取得", () => {
  it("店のカードを先に出し、紹介文を1店1行だけ足して打ち止める", async () => {
    const result = await buildOffersStream(makeDeps({ write: async () => ok("刺身盛りが自慢の一軒です"), judge: async () => ok('{"ok":true,"reason":""}') }), "c1", { party: 2 });
    expect(result.ok).toBe(true);
    const lines = result.ok ? await readLines(result.stream) : [];
    expect(lines.map((l) => l.type)).toEqual(["init", "pitch", "done"]);
    expect(lines[0]).toMatchObject({ fetchId: "fetch-1" });
    expect((lines[0].items as unknown[]).length).toBe(1);
    expect(lines[1]).toEqual({ type: "pitch", storeId: "store-1", reason: "刺身盛りが自慢の一軒です", source: "persona" });
  });

  it("紹介文の口が無い場面では、選定の理由をそのまま1行ずつ出して閉じる", async () => {
    const result = await buildOffersStream(makeDeps(undefined), "c1", { party: 2 });
    const lines = result.ok ? await readLines(result.stream) : [];
    expect(lines.map((l) => l.type)).toEqual(["init", "pitch", "done"]);
    expect(lines[1]).toEqual({ type: "pitch", storeId: "store-1", reason: "近くて好みに合います", source: "fallback" });
  });

  it("選定の出力の検査を通った文だけが客へ出る（AI の本文をそのまま流さない）", async () => {
    expect(SELECTION).toContain("近くて好みに合います");
    const result = await buildOffersStream(makeDeps({ write: async () => ok("口コミでも人気です"), judge: async () => ok('{"ok":true,"reason":""}') }), "c1", { party: 2 });
    const lines = result.ok ? await readLines(result.stream) : [];
    // 決定論のガードに2回落ちるので、決まった文へ倒れる
    expect(lines[1]).toMatchObject({ source: "fallback", reason: "近くて好みに合います" });
  });
});
