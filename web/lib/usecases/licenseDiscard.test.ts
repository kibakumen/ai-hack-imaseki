// 止めた店の営業許可書を消す手続きと、止めた店を戻す手続きのすき間（2026-09-25 安全-20 のレビュー）。
//
//   - 止めて許可書を消した店を戻すと、許可書の無い「承認済み」の店ができ、そのままオファーを公開できた。
//     今は**承認待ちへ戻す**——店が許可書を上げ直し、運営が確かめてから承認する（要件25の基準 25.9 を変えた・AI判断）。
//     承認の写しが残っている店（この直しより前に止めた店・消すのに失敗した店）は、許可書も残っているので承認済みへ戻す。
//   - 許可書を消す手続きが D1 の失敗で投げると、止めることは成り立っているのに運営には 500 が返っていた。
//   - 止められた店は許可書を上げ直せるので、読んでから外すまでの間に上がった新しい鍵が、ファイルを消されないまま
//     条件なしで外され、どこからも指されないファイルが置き場に残っていた。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { interleaved } from "../../tests/_interleavedDb";
import { approvedStore, makeCtx, one, PNG_BYTES, publishOffer, uploadLicense, type Ctx } from "../../../tests/acceptance/v2/_fakes";
import type { Deps } from "../ports";
import type { D1Database } from "../repo/d1";
import { approveStore } from "./approveStore";
import { banStore } from "./banStore";
import { uploadLicense as saveLicense } from "./license";
import { restoreStore } from "./restoreStore";

let ctx: Ctx;
let adminId: string;
const REASON = "許可書の検査";

beforeAll(async () => {
  ctx = await makeCtx();
});
afterAll(async () => {
  await ctx.dispose();
});

const actor = () => ({ accountId: adminId });
const licenseFilesOf = (storeId: string) => [...ctx.files.store.keys()].filter((key) => key.startsWith(`licenses/${storeId}/`));
const storeRow = (storeId: string) =>
  one(ctx.db, "SELECT status, license_key, approved_license_key, approved_name FROM stores WHERE id = ?", storeId) as Promise<{
    status: string;
    license_key: string | null;
    approved_license_key: string | null;
    approved_name: string | null;
  }>;

const readyStore = async (name: string) => {
  const store = await approvedStore(ctx, { name });
  adminId ??= (await one(ctx.db, "SELECT id FROM accounts WHERE role = 'admin'")).id as string;
  return store;
};

describe("止めて戻す（安全-20 のレビュー・基準 25.9）", () => {
  it("止めて許可書を消した店を戻すと、承認待ちへ戻る。公開はできず、許可書を上げ直して運営が承認すると承認済みになる", async () => {
    const store = await readyStore("止めて戻す店");
    expect((await banStore(ctx.deps, store.id, actor(), REASON)).ok).toBe(true);
    expect(await restoreStore(ctx.deps, store.id, actor(), REASON)).toEqual({ ok: true, status: "pending" });

    expect(await storeRow(store.id)).toMatchObject({ status: "pending", license_key: null, approved_license_key: null, approved_name: null });
    expect((await store.api.post("/api/store/offers", { couponIds: [], capacity: 3, partyMax: 4, until: "23:00" })).status).not.toBe(200);
    // 許可書が無いうちは承認できない（基準 25.2）
    expect(await approveStore(ctx.deps, store.id, actor())).toMatchObject({ ok: false, kind: "approval_missing" });

    await uploadLicense(store.api, PNG_BYTES, "again.png", "image/png");
    expect(await approveStore(ctx.deps, store.id, actor())).toEqual({ ok: true });
    expect(await storeRow(store.id)).toMatchObject({ status: "approved" });
    expect((await storeRow(store.id)).approved_license_key).toBe((await storeRow(store.id)).license_key);
    await publishOffer(store.api);
  });

  it("承認の写しが残っている店（この直しより前に止めた店）を戻すと、許可書も残っているので承認済みへ戻る", async () => {
    const store = await readyStore("前に止めた店");
    // 許可書を消す手続きが無かったころの停止（状況だけを書き換えた）
    await ctx.db.prepare("UPDATE stores SET status = 'banned' WHERE id = ?1").bind(store.id).run();
    expect(await restoreStore(ctx.deps, store.id, actor(), REASON)).toEqual({ ok: true, status: "approved" });
    const row = await storeRow(store.id);
    expect(row.status).toBe("approved");
    expect(row.license_key).not.toBeNull();
  });
});

describe("止めたときに許可書を消す手続きの守り（安全-20 のレビュー）", () => {
  it("許可書を消す手続きが D1 の失敗で投げても、止めたことは成り立ち、結果を返し、消せなかったことを記録に残す", async () => {
    const store = await readyStore("消すのに失敗する店");
    const failing: D1Database = {
      ...ctx.db,
      prepare: (query: string) => {
        if (/SELECT status, license_key, approved_license_key FROM stores/.test(query)) throw new Error("D1 unavailable");
        return ctx.db.prepare(query);
      },
      batch: (statements) => ctx.db.batch(statements),
      exec: (query) => ctx.db.exec(query),
    };
    const result = await banStore({ ...ctx.deps, db: failing } as Deps, store.id, actor(), REASON);
    expect(result).toEqual({ ok: true, cancelled: 0, notified: 0 });
    expect((await storeRow(store.id)).status).toBe("banned");
    expect(ctx.logger.entries).toContainEqual(expect.objectContaining({ event: "license_discard_failed", id: store.id }));
  });

  it("読んでから外すまでの間に止められた店が許可書を上げ直しても、新しいファイルを指されないまま置き場に残さない", async () => {
    const store = await readyStore("止める間に上げ直す店");
    let raced: string | null = null;
    const db = interleaved(ctx.db, [
      {
        match: /UPDATE stores SET license_key = NULL/,
        before: async () => {
          await saveLicense(ctx.deps, store.id, { bytes: PNG_BYTES, declaredSize: PNG_BYTES.byteLength });
          raced = (await storeRow(store.id)).license_key;
        },
      },
    ]);
    expect((await banStore({ ...ctx.deps, db } as Deps, store.id, actor(), REASON)).ok).toBe(true);
    expect(raced).not.toBeNull();
    expect(await storeRow(store.id)).toMatchObject({ status: "banned", license_key: null, approved_license_key: null });
    // 表から外した鍵のファイルは全部消えている（新しく上がった分も含めて、どこからも指されないファイルを残さない）
    expect(licenseFilesOf(store.id)).toEqual([]);
  });
});
