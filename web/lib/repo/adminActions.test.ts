// 「状況が変わったときだけ記録を足す」の分かれ道（2026-09-25 監査の指摘 運営-01 のレビュー）。
//
// 承認・止める・戻すは、状況の書き換え（前の状況を WHERE に入れた UPDATE）と記録の追加を1つの batch で流し、
// 記録の INSERT は `WHERE changes() > 0` で「直前の UPDATE が当たったときだけ」に絞っている。手続きの前の
// 確かめで返る道では batch まで届かないので、ここでは repo を直に呼んで、当たらない batch を流す。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvedStore, makeCtx, one, registerStore, type Ctx } from "../../../tests/acceptance/v2/_fakes";
import type { NewAdminAction } from "./adminActions";
import { approvePendingStore, banApprovedStore, findStoreReview, restoreBannedStore } from "./adminStores";

let ctx: Ctx;
let seq = 0;

beforeAll(async () => {
  ctx = await makeCtx();
});

afterAll(async () => {
  await ctx.dispose();
});

const actionFor = (storeId: string, action: NewAdminAction["action"]): NewAdminAction => {
  seq += 1;
  return { id: `repo-action-${seq}`, actorAccountId: "admin-for-repo-test", action, storeId, reason: "検査", detail: null, atIso: ctx.clock.now().toISOString() };
};

const countActions = async (storeId: string): Promise<number> => Number((await one(ctx.db, "SELECT COUNT(*) AS n FROM admin_actions WHERE store_id = ?", storeId)).n);

const snapshotOf = async (storeId: string) => {
  const review = await findStoreReview(ctx.db, storeId);
  if (!review) throw new Error("店が見つかりません");
  return review;
};

describe("当たらなかった batch は記録を残さない", () => {
  it("未承認の店を止める・戻す batch は当たらず（止めるは null・戻すは false）、記録の行は増えない", async () => {
    const pending = await registerStore(ctx, { name: "repo で止められない店" });
    const nowIso = ctx.clock.now().toISOString();
    expect(await banApprovedStore(ctx.db, pending.id, nowIso, actionFor(pending.id, "ban"))).toBeNull();
    expect(await restoreBannedStore(ctx.db, pending.id, actionFor(pending.id, "restore"))).toBe(false);
    expect(await countActions(pending.id)).toBe(0);
    expect((await one(ctx.db, "SELECT status FROM stores WHERE id = ?", pending.id)).status).toBe("pending");
  });

  it("承認済みの店を承認する・戻す batch は false を返し、記録の行は増えない", async () => {
    const store = await approvedStore(ctx, { name: "repo で二度承認できない店" });
    const before = await countActions(store.id);
    expect(await approvePendingStore(ctx.db, store.id, await snapshotOf(store.id), actionFor(store.id, "approve"))).toBe(false);
    expect(await restoreBannedStore(ctx.db, store.id, actionFor(store.id, "restore"))).toBe(false);
    expect(await countActions(store.id)).toBe(before);
  });

  it("当たった batch は結果を返し、記録が1行増える（分かれ道のもう片方）", async () => {
    const store = await approvedStore(ctx, { name: "repo で止められる店" });
    const before = await countActions(store.id);
    expect(await banApprovedStore(ctx.db, store.id, ctx.clock.now().toISOString(), actionFor(store.id, "ban"))).not.toBeNull();
    expect(await countActions(store.id)).toBe(before + 1);
    // 同じ文をもう1度流しても、もう承認済みではないので当たらず、増えない
    expect(await banApprovedStore(ctx.db, store.id, ctx.clock.now().toISOString(), actionFor(store.id, "ban"))).toBeNull();
    expect(await countActions(store.id)).toBe(before + 1);
  });
});
