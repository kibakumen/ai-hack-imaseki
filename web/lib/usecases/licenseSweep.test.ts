// どの店の行からも指されていない営業許可書のファイルを消す掃除（2026-09-25 監査の指摘 安全-20 の案1 の残り・レビュー）。
//
// 許可書を消す手続き（上げ直し・取り下げ・止めたとき）は、置き場から消せなかったファイルを記録に残すだけで、
// 置き場には残っていた。店主の氏名と住所が載りうるので、どこからも指されなくなったファイルは消す。
//   - 上げている途中（置き場に置いた・表はまだ前の鍵）のファイルを消さないよう、置いてから1時間たったものだけを消す
//     （鍵に置いた時刻を入れる。時刻の無い古い形の鍵は、この直しより前に置いたもの＝十分に古い）
//   - 1日に1回まで（許可書の操作のあとに、応答を待たせずに走らせる）

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvedStore, makeCtx, PNG_BYTES, uploadLicense, type Ctx } from "../../../tests/acceptance/v2/_fakes";
import type { Deps, FileStore } from "../ports";
import { runLicenseSweep } from "./licenseSweep";

let ctx: Ctx;
const HOUR_MS = 60 * 60 * 1000;

beforeAll(async () => {
  ctx = await makeCtx();
});
afterAll(async () => {
  await ctx.dispose();
});

const filesOf = (storeId: string) => [...ctx.files.store.keys()].filter((key) => key.startsWith(`licenses/${storeId}/`)).sort();
const putFile = (key: string) => ctx.files.put(key, PNG_BYTES, "image/png");
const advance = (ms: number) => ctx.clock.set(new Date(ctx.clock.now().getTime() + ms).toISOString());

describe("指されていない許可書のファイルの掃除（安全-20）", () => {
  it("上げた許可書の鍵には置いた時刻が入る（掃除が、上げている途中のファイルを見分けるため）", async () => {
    const store = await approvedStore(ctx, { name: "鍵の形の店" });
    const [key] = filesOf(store.id);
    expect(key).toMatch(new RegExp(`^licenses/${store.id}/\\d{13}-`));
  });

  it("表から指されていない古いファイルと、時刻の無い古い形のファイルを消し、指されているファイルと置いたばかりのファイルは残す。1日に1回まで", async () => {
    const store = await approvedStore(ctx, { name: "掃除の店" });
    await uploadLicense(store.api, PNG_BYTES, "again.png", "image/png");
    const referenced = filesOf(store.id);
    expect(referenced).toHaveLength(2); // 今の分と承認の写し

    const now = ctx.clock.now().getTime();
    const orphan = `licenses/${store.id}/${now - 2 * HOUR_MS}-orphan`;
    const legacy = `licenses/${store.id}/legacytoken`;
    const fresh = `licenses/${store.id}/${now}-uploading`;
    await Promise.all([putFile(orphan), putFile(legacy), putFile(fresh)]);

    await runLicenseSweep(ctx.deps);
    expect(filesOf(store.id)).toEqual([...referenced, fresh].sort());
    expect(ctx.logger.entries).toContainEqual(expect.objectContaining({ event: "license_orphan_deleted", id: store.id }));

    // 同じ日のうちは走らない
    const another = `licenses/${store.id}/${now - 3 * HOUR_MS}-another`;
    await putFile(another);
    await runLicenseSweep(ctx.deps);
    expect(filesOf(store.id)).toContain(another);

    // 1日たてば、置いてから1時間を過ぎた分（さっきは置いたばかりだったものも）を消す
    advance(25 * HOUR_MS);
    await runLicenseSweep(ctx.deps);
    expect(filesOf(store.id)).toEqual(referenced);
  });

  it("置き場が一覧を出せない（list の無い）口では何もしない", async () => {
    const files = ctx.deps.files as FileStore;
    const withoutList: FileStore = { put: files.put, get: files.get, delete: files.delete };
    const before = [...ctx.files.store.keys()];
    await expect(runLicenseSweep({ ...ctx.deps, files: withoutList } as Deps)).resolves.toBeUndefined();
    expect([...ctx.files.store.keys()]).toEqual(before);
  });
});
