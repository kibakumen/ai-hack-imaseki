// 店の雰囲気画像を取る手続きの検査。
//
// ⚠️ いちばん大事なのは3つ目——**この口を持たない差し替え（受け入れ検査の偽物）では外へ聞かずに
// null を返す**。usecases/placeLabel と同じ支え方（geocoder.reverse を持たない場面と同じ考え）。
import { describe, expect, it } from "vitest";
import type { Deps } from "../ports";
import { storeImage } from "./storeImage";

/** この手続きが触るものだけを持つ最小の Deps（ほかは呼ばれないので置かない）。 */
const depsWith = (fetcher?: Deps["storeImage"]): Deps =>
  ({
    clock: { now: () => new Date("2026-09-22T06:00:00.000Z"), after: () => new Promise<void>(() => {}) },
    storeImage: fetcher,
  }) as unknown as Deps;

const INPUT = { url: "https://example.com/store" };

describe("usecases/storeImage", () => {
  it("取れたら画像の URL を返す。URL をそのまま渡し、打ち切りの合図も渡す", async () => {
    const calls: Array<{ url: string; hasSignal: boolean }> = [];
    const deps = depsWith({
      fetch: async (url, opts) => {
        calls.push({ url, hasSignal: opts.signal instanceof AbortSignal });
        return { ok: true, imageUrl: "https://example.com/a.jpg" };
      },
    });

    expect(await storeImage(deps, INPUT)).toEqual({ imageUrl: "https://example.com/a.jpg" });
    expect(calls).toEqual([{ url: INPUT.url, hasSignal: true }]);
  });

  it("取れなかったら null を返す（断りにはしない——画像は飾り）", async () => {
    const deps = depsWith({ fetch: async () => ({ ok: false }) });
    expect(await storeImage(deps, INPUT)).toEqual({ imageUrl: null });
  });

  it("この口を持たない差し替えでは、外へ聞かずに null を返す", async () => {
    expect(await storeImage(depsWith(undefined), INPUT)).toEqual({ imageUrl: null });
  });

  it("口が例外を投げても null を返す（打ち切りと同じ扱い）", async () => {
    const deps = depsWith({
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect(await storeImage(deps, INPUT)).toEqual({ imageUrl: null });
  });
});
