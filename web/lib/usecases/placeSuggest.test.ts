// 場所の候補を出す手続きの検査。
//
// ⚠️ いちばん大事なのは2つ目——**候補の口を持たない差し替えでは外へ聞かずに空を返す**。
// 受け入れ検査の偽物（`tests/acceptance/v2/_fakes.ts` の `fakeGeocoder`）はこの口を持たないので、
// ここで倒れずに空を返すことが、検査の場面を壊さない支えになっている（usecases/placeLabel と同じ）。
import { describe, expect, it, vi } from "vitest";
import type { Deps } from "../ports";
import { placeSuggest } from "./placeSuggest";

const depsWith = (geocoder: Partial<Deps["geocoder"]>): Deps & { entries: unknown[] } => {
  const entries: unknown[] = [];
  return {
    entries,
    clock: { now: () => new Date("2026-09-22T06:00:00.000Z"), after: () => new Promise<void>(() => {}) },
    logger: { log: (entry: unknown) => entries.push(entry) },
    geocoder: { geocode: async () => ({ ok: false as const }), ...geocoder },
  } as unknown as Deps & { entries: unknown[] };
};

describe("usecases/placeSuggest", () => {
  it("取れたら候補を返す（最大5件）。文字をそのまま渡し、打ち切りの合図も渡す。経路は記録に残し、文字は残さない", async () => {
    const calls: Array<{ text: string; hasSignal: boolean }> = [];
    const deps = depsWith({
      suggest: async (text, opts) => {
        calls.push({ text, hasSignal: opts.signal instanceof AbortSignal });
        return { ok: true, source: "places", suggestions: ["a", "b", "c", "d", "e", "f"] };
      },
    });

    expect(await placeSuggest(deps, { q: "渋谷" })).toEqual({ suggestions: ["a", "b", "c", "d", "e"] });
    expect(calls).toEqual([{ text: "渋谷", hasSignal: true }]);
    expect(deps.entries).toEqual([{ event: "place_suggest.places", durationMs: 0 }]);
    expect(JSON.stringify(deps.entries)).not.toContain("渋谷");
  });

  it("候補の口を持たない差し替えでは、外へ聞かずに空を返す", async () => {
    const geocode = vi.fn(async () => ({ ok: false as const }));
    const deps = depsWith({ geocode });
    expect(await placeSuggest(deps, { q: "渋谷" })).toEqual({ suggestions: [] });
    expect(geocode).not.toHaveBeenCalled();
    expect(deps.entries).toEqual([]);
  });

  it("取れなかった（ok:false）・口が例外を投げた、のどちらも空を返す（断りにはしない）", async () => {
    expect(await placeSuggest(depsWith({ suggest: async () => ({ ok: false }) }), { q: "渋谷" })).toEqual({ suggestions: [] });
    const throwing = depsWith({
      suggest: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect(await placeSuggest(throwing, { q: "渋谷" })).toEqual({ suggestions: [] });
    expect(throwing.entries).toEqual([{ event: "place_suggest", durationMs: 0, errorKind: "unavailable" }]);
  });
});
