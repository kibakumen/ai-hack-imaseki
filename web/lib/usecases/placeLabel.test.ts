// 位置を地名へ直す手続きの検査。
//
// ⚠️ いちばん大事なのは3つ目——**逆方向の口を持たない差し替えでは外へ聞かずに `null` を返す**。
// 受け入れ検査の偽物（`tests/acceptance/v2/_fakes.ts` の `fakeGeocoder`）はこの口を持たないので、
// ここで倒れずに `null` を返すことが、検査の場面を壊さない支えになっている。
import { describe, expect, it, vi } from "vitest";
import type { Deps } from "../ports";
import { placeLabel } from "./placeLabel";

/** この手続きが触るものだけを持つ最小の Deps（ほかは呼ばれないので置かない）。 */
const depsWith = (geocoder: Partial<Deps["geocoder"]>): Deps =>
  ({
    clock: { now: () => new Date("2026-09-22T06:00:00.000Z"), after: () => new Promise<void>(() => {}) },
    geocoder: { geocode: async () => ({ ok: false as const }), ...geocoder },
  }) as unknown as Deps;

const SHIBUYA = { lat: 35.6595, lng: 139.7005 };

describe("usecases/placeLabel", () => {
  it("直せたら地名を返す。座標をそのまま渡し、打ち切りの合図も渡す", async () => {
    const calls: Array<{ point: unknown; hasSignal: boolean }> = [];
    const deps = depsWith({
      reverse: async (point, opts) => {
        calls.push({ point, hasSignal: opts.signal instanceof AbortSignal });
        return { ok: true, label: "東京都渋谷区道玄坂1-1" };
      },
    });

    expect(await placeLabel(deps, SHIBUYA)).toEqual({ label: "東京都渋谷区道玄坂1-1" });
    expect(calls).toEqual([{ point: SHIBUYA, hasSignal: true }]);
  });

  it("直せなかったら null を返す（断りにはしない——客は座標のまま探せる）", async () => {
    const deps = depsWith({ reverse: async () => ({ ok: false }) });
    expect(await placeLabel(deps, SHIBUYA)).toEqual({ label: null });
  });

  it("逆方向の口を持たない差し替えでは、外へ聞かずに null を返す", async () => {
    const geocode = vi.fn(async () => ({ ok: false as const }));
    const deps = depsWith({ geocode });
    expect(await placeLabel(deps, SHIBUYA)).toEqual({ label: null });
    expect(geocode).not.toHaveBeenCalled();
  });

  it("口が例外を投げても null を返す（打ち切りと同じ扱い）", async () => {
    const deps = depsWith({
      reverse: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect(await placeLabel(deps, SHIBUYA)).toEqual({ label: null });
  });
});
