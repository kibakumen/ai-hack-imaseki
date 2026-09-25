// ファイル置き場の実物（R2）の一覧（2026-09-25 安全-20 のレビュー。指されていない許可書の掃除が使う）。
// R2 の list は1頁に1000件までで、続きは cursor で読む。頁をたどって集め、上限の頁で止まることを見る。

import { describe, expect, it } from "vitest";
import { createFileStore, type PermitBucket } from "./files";

/** 1頁に `perPage` 件ずつ返す偽の束縛。読まれた頁の数を数える。 */
const pagedBucket = (keys: string[], perPage: number) => {
  let pagesRead = 0;
  const bucket: PermitBucket = {
    put: async () => undefined,
    get: async () => null,
    delete: async () => undefined,
    list: async ({ prefix, cursor }) => {
      pagesRead += 1;
      const matching = keys.filter((key) => key.startsWith(prefix));
      const start = cursor ? Number(cursor) : 0;
      const end = start + perPage;
      return { objects: matching.slice(start, end).map((key) => ({ key })), truncated: end < matching.length, cursor: end < matching.length ? String(end) : undefined };
    },
  };
  return { bucket, pages: () => pagesRead };
};

describe("adapters/files の list", () => {
  it("頁をたどって、前置きで始まる鍵を全部集める", async () => {
    const keys = ["licenses/a/1", "licenses/a/2", "licenses/b/3", "other/x", "licenses/c/4", "licenses/c/5"];
    const { bucket, pages } = pagedBucket(keys, 2);
    expect(await createFileStore(bucket).list!("licenses/")).toEqual(["licenses/a/1", "licenses/a/2", "licenses/b/3", "licenses/c/4", "licenses/c/5"]);
    expect(pages()).toBe(3);
  });

  it("上限の10頁で止まる（残りは次の掃除に回る）", async () => {
    const keys = Array.from({ length: 30 }, (_, i) => `licenses/s/${String(i).padStart(2, "0")}`);
    const { bucket, pages } = pagedBucket(keys, 1);
    expect(await createFileStore(bucket).list!("licenses/")).toHaveLength(10);
    expect(pages()).toBe(10);
  });
});
