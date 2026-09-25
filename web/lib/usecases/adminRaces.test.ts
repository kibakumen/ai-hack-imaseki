// 運営の操作が、同時に来たほかの操作に負けたとき（2026-09-25 監査の指摘 運営-01・運営-02・運営-04 のレビュー）。
//
// 受け入れ検査の入口からは「読んでから書くまでの間に、ほかの操作が先に書いた」形を作れない。ここでは
// 手続きに渡す口（D1・置き場）を包んで、その間にほかの操作を1つ差し込む。
//   - 負けた操作は、先に読んだ古い状況ではなく**今の状況**を返す（画面が「すでに『◯◯』に」と出すため）
//   - 承認の写しは、読んだ店名・住所・許可書のまま入る（間に変わったら承認しない）
//   - 許可書の上げ直しと承認がすれ違っても、承認に使った許可書は消えない
//   - 仮のパスワードの発行は、記録が書けなければ店のパスワードもセッションも変えない

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approvedStore, makeCtx, one, PDF_BYTES, PNG_BYTES, registerCard, registerStore, rows, seedAdmin, uploadLicense, type Ctx } from "../../../tests/acceptance/v2/_fakes";
import type { Deps } from "../ports";
import type { D1Database } from "../repo/d1";
import { approveStore } from "./approveStore";
import { banStore } from "./banStore";
import { issueTempPassword } from "./issueTempPassword";
import { uploadLicense as saveLicense } from "./license";
import { restoreStore } from "./restoreStore";

let ctx: Ctx;
let adminId: string;
const REASON = "同時の操作の検査";

beforeAll(async () => {
  ctx = await makeCtx();
  await seedAdmin(ctx);
  adminId = (await one(ctx.db, "SELECT id FROM accounts WHERE role = 'admin'")).id as string;
});

afterAll(async () => {
  await ctx.dispose();
});

const actor = () => ({ accountId: adminId });

/** `batch` の直前に1文を流す D1（同時に来たほかの操作が、先に書き終えた形を作る）。 */
const dbRacedBy = (sql: string, ...params: unknown[]): D1Database => ({
  prepare: (query) => ctx.db.prepare(query),
  exec: (query) => ctx.db.exec(query),
  batch: async (statements) => {
    await ctx.db.prepare(sql).bind(...params).run();
    return ctx.db.batch(statements);
  },
});

const depsWith = (over: Partial<Deps>): Deps => ({ ...ctx.deps, ...over });

const statusOf = async (storeId: string) => (await one(ctx.db, "SELECT status FROM stores WHERE id = ?", storeId)).status as string;
const actionsOf = (storeId: string) => rows(ctx.db, "SELECT action FROM admin_actions WHERE store_id = ? ORDER BY rowid", storeId);

/** 許可書とカードが揃った未承認の店（承認を押せる店）。 */
const readyToApprove = async (name: string) => {
  const store = await registerStore(ctx, { name });
  await uploadLicense(store.api, PDF_BYTES);
  await registerCard(store.api);
  return store;
};

describe("負けた操作は今の状況を返す（運営-04 のレビュー）", () => {
  it("止める間に、ほかの操作が先に止めていたら『止められている』を返し、記録を残さない", async () => {
    const store = await approvedStore(ctx, { name: "先に止められる店" });
    const result = await banStore(depsWith({ db: dbRacedBy("UPDATE stores SET status = 'banned' WHERE id = ?1", store.id) }), store.id, actor(), REASON);
    expect(result).toEqual({ ok: false, kind: "state", state: "banned" });
    expect((await actionsOf(store.id)).map((a) => a.action)).toEqual(["approve"]);
  });

  it("戻す間に、ほかの操作が先に戻していたら『承認済み』を返す", async () => {
    const store = await approvedStore(ctx, { name: "先に戻される店" });
    expect((await banStore(ctx.deps, store.id, actor(), REASON)).ok).toBe(true);
    const result = await restoreStore(depsWith({ db: dbRacedBy("UPDATE stores SET status = 'approved' WHERE id = ?1", store.id) }), store.id, actor(), REASON);
    expect(result).toEqual({ ok: false, kind: "state", state: "approved" });
  });

  it("承認する間に、ほかの操作が先に承認していたら『承認済み』を返す", async () => {
    const store = await readyToApprove("先に承認される店");
    const result = await approveStore(depsWith({ db: dbRacedBy("UPDATE stores SET status = 'approved' WHERE id = ?1", store.id) }), store.id, actor());
    expect(result).toEqual({ ok: false, kind: "state", state: "approved" });
    expect(await actionsOf(store.id)).toEqual([]);
  });
});

describe("承認の写しは、読んだ内容のまま入る（運営-02 のレビュー）", () => {
  it("承認する間に店が許可書を上げ直していたら承認せず、変わったことを返す（未承認のまま・記録なし）", async () => {
    const store = await readyToApprove("承認の間に差し替える店");
    const raced = dbRacedBy("UPDATE stores SET license_key = 'licenses/raced/other', license_uploaded_at = '2026-09-22T06:30:00.000Z' WHERE id = ?1", store.id);
    const result = await approveStore(depsWith({ db: raced }), store.id, actor());
    expect(result).toEqual({ ok: false, kind: "changed", state: "pending" });
    expect(await statusOf(store.id)).toBe("pending");
    expect(await one(ctx.db, "SELECT approved_license_key FROM stores WHERE id = ?", store.id)).toEqual({ approved_license_key: null });
    expect(await actionsOf(store.id)).toEqual([]);
  });

  it("承認する間に店が店名を変えていたら承認しない", async () => {
    const store = await readyToApprove("承認の間に名前を変える店");
    const result = await approveStore(depsWith({ db: dbRacedBy("UPDATE stores SET name = '近所の有名店' WHERE id = ?1", store.id) }), store.id, actor());
    expect(result).toEqual({ ok: false, kind: "changed", state: "pending" });
    expect(await statusOf(store.id)).toBe("pending");
  });

  it("許可書の上げ直しの途中で承認が入っても、承認に使った許可書は消えない", async () => {
    const store = await readyToApprove("上げ直しと承認がすれ違う店");
    const reviewed = (await one(ctx.db, "SELECT license_key FROM stores WHERE id = ?", store.id)).license_key as string;
    const files = ctx.deps.files;
    // 新しいファイルを置いている最中に、運営の承認が先に書き終わる（承認の写しは、まだ表が指している前の許可書）
    const racingFiles: Deps["files"] = {
      ...files,
      put: async (key, body, contentType) => {
        await ctx.db
          .prepare(
            `UPDATE stores SET status = 'approved', approved_name = name, approved_address = address,
                    approved_license_key = license_key, approved_license_mime = license_mime WHERE id = ?1`,
          )
          .bind(store.id)
          .run();
        await files.put(key, body, contentType);
      },
    };
    expect(await saveLicense(depsWith({ files: racingFiles }), store.id, { bytes: PNG_BYTES, declaredSize: PNG_BYTES.byteLength })).toEqual({ ok: true });
    expect((await one(ctx.db, "SELECT approved_license_key FROM stores WHERE id = ?", store.id)).approved_license_key).toBe(reviewed);
    expect(ctx.files.store.has(reviewed)).toBe(true);
  });
});

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
