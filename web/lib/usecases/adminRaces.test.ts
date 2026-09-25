// 運営の操作が、同時に来たほかの操作に負けたとき（2026-09-25 監査の指摘 運営-01・運営-02・運営-04 のレビュー）。
//
// 受け入れ検査の入口からは「途中で落ちた」形を作れない。ここでは手続きに渡す口（D1）を包んで落とす。
//   - 仮のパスワードの発行は、記録が書けなければ店のパスワードもセッションも変えない

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeCtx, one, registerStore, rows, seedAdmin, type Ctx } from "../../../tests/acceptance/v2/_fakes";
import type { Deps } from "../ports";
import type { D1Database } from "../repo/d1";
import { issueTempPassword } from "./issueTempPassword";

let ctx: Ctx;
let adminId: string;

beforeAll(async () => {
  ctx = await makeCtx();
  await seedAdmin(ctx);
  adminId = (await one(ctx.db, "SELECT id FROM accounts WHERE role = 'admin'")).id as string;
});

afterAll(async () => {
  await ctx.dispose();
});

const actor = () => ({ accountId: adminId });

const depsWith = (over: Partial<Deps>): Deps => ({ ...ctx.deps, ...over });

describe("仮のパスワードの発行は1つのまとまり（運営-01 のレビュー）", () => {
  it("記録が書けなければ、店のパスワードもセッションも変えない", async () => {
    const store = await registerStore(ctx, { name: "記録が書けない発行の店" });
    const before = await one(ctx.db, "SELECT password_hash, must_change_password FROM accounts WHERE store_id = ?", store.id);
    const sessionsBefore = await rows(ctx.db, "SELECT token_hash FROM sessions WHERE account_id = (SELECT id FROM accounts WHERE store_id = ?)", store.id);
    expect(sessionsBefore.length).toBeGreaterThan(0);
    // 記録の表が無い本番（migration 0011 の当て忘れ）と同じ落ち方をさせる
    const broken: D1Database = {
      prepare: (query) => ctx.db.prepare(query.replace("INSERT INTO admin_actions", "INSERT INTO admin_actions_missing")),
      exec: (query) => ctx.db.exec(query),
      batch: (statements) => ctx.db.batch(statements),
    };
    await expect(issueTempPassword(depsWith({ db: broken }), store.id, actor(), ctx.admin!.password)).rejects.toThrow();
    expect(await one(ctx.db, "SELECT password_hash, must_change_password FROM accounts WHERE store_id = ?", store.id)).toEqual(before);
    expect(await rows(ctx.db, "SELECT token_hash FROM sessions WHERE account_id = (SELECT id FROM accounts WHERE store_id = ?)", store.id)).toEqual(sessionsBefore);
    expect((await store.api.get("/api/store/home")).status).toBe(200);
  });
});
