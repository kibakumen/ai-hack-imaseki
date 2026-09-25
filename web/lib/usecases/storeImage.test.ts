// 店の雰囲気画像の手続きの検査（2026-09-25 監査の指摘 安全-12・安全-19 の直しのあとの形）。
//
// 画像は**店が情報を保存したときに1回だけ**取り、置き場に置いて自分のオリジンから配る。客の要求のたびに
// 外へ取りに行くことも、客の端末が店のサーバーから直接読むことも無い。ここは置き場の出し入れを偽物で見る。
import { describe, expect, it } from "vitest";
import type { Deps, StoreImageFetcher } from "../ports";
import { refreshStoreImage } from "./storeImage";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);

const depsWith = (fetcher?: StoreImageFetcher) => {
  const files = new Map<string, { body: Uint8Array; contentType: string }>();
  const logs: unknown[] = [];
  const deps = {
    clock: { now: () => new Date("2026-09-22T06:00:00.000Z"), after: () => new Promise<void>(() => {}) },
    storeImage: fetcher,
    logger: { log: (entry: unknown) => logs.push(entry) },
    files: {
      put: async (key: string, body: Uint8Array, contentType: string) => {
        files.set(key, { body, contentType });
      },
      get: async (key: string) => files.get(key) ?? null,
      delete: async (key: string) => {
        files.delete(key);
      },
    },
  } as unknown as Deps;
  return { deps, files, logs };
};

const KEY = "store-images/store-1";

describe("usecases/storeImage refreshStoreImage（店の情報の保存のときに1回だけ）", () => {
  it("取れたら置き場に置く。店の URL をそのまま渡し、打ち切りの合図も渡す", async () => {
    const calls: Array<{ url: string; hasSignal: boolean }> = [];
    const { deps, files } = depsWith({
      fetch: async (url, opts) => {
        calls.push({ url, hasSignal: opts.signal instanceof AbortSignal });
        return { ok: true, image: { body: PNG, contentType: "image/png" } };
      },
    });

    await refreshStoreImage(deps, "store-1", { url: "https://example.com/store", previousUrl: null });
    expect(calls).toEqual([{ url: "https://example.com/store", hasSignal: true }]);
    expect(files.get(KEY)).toEqual({ body: PNG, contentType: "image/png" });
  });

  it("口が画像でないバイトを返しても置かない（種類は先頭のバイトで確かめ直す）", async () => {
    const { deps, files } = depsWith({ fetch: async () => ({ ok: true, image: { body: new TextEncoder().encode("<svg/>"), contentType: "image/png" } }) });
    await refreshStoreImage(deps, "store-1", { url: "https://example.com/store", previousUrl: null });
    expect(files.has(KEY)).toBe(false);
  });

  it("URL を空にしたら、前の画像を消す（外へは聞かない）", async () => {
    let called = false;
    const { deps, files } = depsWith({
      fetch: async () => {
        called = true;
        return { ok: false };
      },
    });
    files.set(KEY, { body: PNG, contentType: "image/png" });
    await refreshStoreImage(deps, "store-1", { url: null, previousUrl: "https://example.com/old" });
    expect(files.has(KEY)).toBe(false);
    expect(called).toBe(false);
  });

  it("URL を変えて取れなかったら、前の画像を消す（別のページの画像を出し続けない）", async () => {
    const { deps, files } = depsWith({ fetch: async () => ({ ok: false }) });
    files.set(KEY, { body: PNG, contentType: "image/png" });
    await refreshStoreImage(deps, "store-1", { url: "https://example.com/new", previousUrl: "https://example.com/old" });
    expect(files.has(KEY)).toBe(false);
  });

  it("同じ URL のまま一時的に取れなかったときは、前の画像を残す", async () => {
    const { deps, files } = depsWith({ fetch: async () => ({ ok: false }) });
    files.set(KEY, { body: PNG, contentType: "image/png" });
    await refreshStoreImage(deps, "store-1", { url: "https://example.com/same", previousUrl: "https://example.com/same" });
    expect(files.get(KEY)).toEqual({ body: PNG, contentType: "image/png" });
  });

  it("口が例外を投げても、置き場が落ちても、保存の筋へ例外を出さない（画像は飾り）", async () => {
    const { deps, logs } = depsWith({
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await expect(refreshStoreImage(deps, "store-1", { url: "https://example.com/store", previousUrl: null })).resolves.toBeUndefined();

    const broken = depsWith({ fetch: async () => ({ ok: true, image: { body: PNG, contentType: "image/png" } }) });
    (broken.deps.files as { put: unknown }).put = async () => {
      throw new Error("R2 down");
    };
    await expect(refreshStoreImage(broken.deps, "store-1", { url: "https://example.com/store", previousUrl: null })).resolves.toBeUndefined();
    expect(broken.logs).toContainEqual({ event: "store_image_refresh_failed", id: "store-1" });
    expect(logs).toEqual([]);
  });

  it("この口を持たない差し替えでは、外へ聞かずに何もしない", async () => {
    const { deps, files } = depsWith(undefined);
    files.set(KEY, { body: PNG, contentType: "image/png" });
    await refreshStoreImage(deps, "store-1", { url: "https://example.com/store", previousUrl: "https://example.com/store" });
    expect(files.get(KEY)).toEqual({ body: PNG, contentType: "image/png" });
  });
});
