// 店の情報の保存のうち、受け入れ検査が見ない1つ——**地図が返らないまま3秒経ったとき**を見る
// （設計書「時間の割り振り」: 地図3秒を、差し替えた時計と AbortSignal の両方で書く）。
// 当たる／0件／失敗／日本の外は受け入れ検査 r15 が見るので、ここでは繰り返さない。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { interleaved } from "../../tests/_interleavedDb";
import { makeCtx, one, registerStore, type Ctx } from "../../../tests/acceptance/v2/_fakes";
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
    // 地図へ問い合わせ始めたら時計を進める（保存済みの住所を先に読むので、呼んだ直後には進めない・店-18）
    let geocodeStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => (geocodeStarted = resolve));
    const deps = {
      clock,
      geocoder: {
        // 解かれるまで返らない（受け入れ検査の偽物の "hang" と同じ）。
        geocode: (_text: string, opts: { signal?: AbortSignal }) =>
          new Promise<{ ok: false }>((resolve) => {
            geocodeStarted();
            opts.signal?.addEventListener("abort", () => {
              aborted = true;
              resolve({ ok: false });
            });
          }),
      },
      db: {
        prepare: () => ({
          bind: () => ({
            // 保存済みの住所は無い（初めての保存）＝地図へ問い合わせる
            first: async () => null,
            run: async () => {
              wrote = true;
            },
          }),
        }),
      },
    } as unknown as Deps;

    const saving = saveStoreProfile(deps, "store-1", INPUT);
    await started;
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

describe("usecases/saveStoreProfile の読んでから書く隙（店-18 のレビュー）", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await makeCtx();
  });
  afterAll(async () => {
    await ctx.dispose();
  });

  const X = { address: "東京都渋谷区道玄坂1-1-競合X", lat: 35.658, lng: 139.701 };
  const Y = { address: "東京都新宿区西新宿2-8-競合Y", lat: 35.689, lng: 139.692 };

  it("住所を変えない保存が位置をそのまま使う間に、別のタブが住所と位置を変えても、住所と位置が食い違ったまま残らない", async () => {
    ctx.geocoder.set(X.address, { lat: X.lat, lng: X.lng });
    ctx.geocoder.set(Y.address, { lat: Y.lat, lng: Y.lng });
    const store = await registerStore(ctx);
    expect(await saveStoreProfile(ctx.deps, store.id, { ...INPUT, address: X.address })).toMatchObject({ ok: true });

    // タブB（古いフォーム・住所は X のまま・予算だけを直す）が住所以外を書く直前に、タブA が住所を Y に変えて保存し終える
    const db = interleaved(ctx.db, [
      {
        match: /budget_max = \?8 WHERE/,
        before: async () => {
          expect(await saveStoreProfile(ctx.deps, store.id, { ...INPUT, address: Y.address })).toMatchObject({ ok: true });
        },
      },
    ]);
    const tabB = await saveStoreProfile({ ...ctx.deps, db } as Deps, store.id, { ...INPUT, address: X.address, budgetMax: 5000 });
    expect(tabB).toMatchObject({ ok: true });

    const row = await one(ctx.db, "SELECT address, lat, lng FROM stores WHERE id = ?", store.id);
    const expected = row.address === X.address ? X : Y;
    expect(row, "住所と位置は同じ地点を指す").toEqual({ address: expected.address, lat: expected.lat, lng: expected.lng });
  });
});
