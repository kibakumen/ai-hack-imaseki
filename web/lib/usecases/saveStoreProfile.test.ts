// 店の情報の保存のうち、受け入れ検査が見ない1つ——**地図が返らないまま3秒経ったとき**を見る
// （設計書「時間の割り振り」: 地図3秒を、差し替えた時計と AbortSignal の両方で書く）。
// 当たる／0件／失敗／日本の外は受け入れ検査 r15 が見るので、ここでは繰り返さない。
import { describe, expect, it } from "vitest";
import type { Deps } from "../ports";
import { GEOCODE_TIMEOUT_MS } from "../schemas/limits";
import type { StoreProfileInput } from "../schemas/store";
import { saveStoreProfile } from "./saveStoreProfile";

/** 進めた時にだけ合図を起こす偽の時計（受け入れ検査の _fakes.ts と同じ考え方）。 */
const fakeClock = () => {
  let now = 0;
  const waiters: Array<{ at: number; resolve: () => void }> = [];
  return {
    clock: {
      now: () => new Date(now),
      after: (ms: number) => new Promise<void>((resolve) => waiters.push({ at: now + ms, resolve })),
    },
    advance: (ms: number) => {
      now += ms;
      for (const w of [...waiters]) {
        if (w.at <= now) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve();
        }
      }
    },
  };
};

const INPUT: StoreProfileInput = {
  name: "店",
  address: "東京都渋谷区道玄坂1-1",
  url: null,
  genres: ["和食"],
  menus: [],
  budgetMin: 2000,
  budgetMax: 4000,
};

describe("usecases/saveStoreProfile", () => {
  it("地図が3秒返らなければ、外への呼び出しを解いて「住所を直せなかった」に倒し、何も保存しない", async () => {
    const { clock, advance } = fakeClock();
    let aborted = false;
    let wrote = false;
    const deps = {
      clock,
      geocoder: {
        // 解かれるまで返らない（受け入れ検査の偽物の "hang" と同じ）。
        geocode: (_text: string, opts: { signal?: AbortSignal }) =>
          new Promise<{ ok: false }>((resolve) => {
            opts.signal?.addEventListener("abort", () => {
              aborted = true;
              resolve({ ok: false });
            });
          }),
      },
      db: {
        prepare: () => ({
          bind: () => ({
            run: async () => {
              wrote = true;
            },
          }),
        }),
      },
    } as unknown as Deps;

    const saving = saveStoreProfile(deps, "store-1", INPUT);
    advance(GEOCODE_TIMEOUT_MS);

    expect(await saving).toMatchObject({ ok: false, kind: "address_unresolved" });
    expect(aborted, "打ち切りで AbortSignal を立てる").toBe(true);
    expect(wrote, "直せなかったときは書かない").toBe(false);
  });

  it("おすすめメニューが上限を超える・予算の最低が最高より上のときは、地図を呼ばずに断る", async () => {
    const { clock } = fakeClock();
    let called = false;
    const deps = {
      clock,
      geocoder: {
        geocode: async () => {
          called = true;
          return { ok: false as const };
        },
      },
      db: { prepare: () => ({ bind: () => ({ run: async () => undefined }) }) },
    } as unknown as Deps;

    const tooMany = await saveStoreProfile(deps, "store-1", { ...INPUT, menus: ["a", "b", "c", "d", "e", "f"] });
    expect(tooMany).toMatchObject({ ok: false, kind: "invalid_input", fields: [{ name: "menus", reason: "too_many" }] });

    const minOverMax = await saveStoreProfile(deps, "store-1", { ...INPUT, budgetMin: 5000, budgetMax: 4000 });
    expect(minOverMax).toMatchObject({ ok: false, kind: "invalid_input", fields: [{ name: "budgetMin", reason: "min_over_max" }] });

    expect(called, "手元で分かる断りは地図を呼ぶ前に返す").toBe(false);
  });
});
