// 店の登録が、同じメールアドレスの同時登録でも断りへ倒れること（要件12の基準 12.2）。
//
// ⚠️ なぜ受け入れ検査とは別にこれを置くか（2026-09-22 タスク25）: 受け入れ検査は入口を順に叩くので、
// 「先回りの確かめは通ったのに、書き込みの時点ではもう在る」という**並びの隙間**を作れない。
// ここでは `deps.hasher` に割り込んで、先回りの確かめと書き込みの**あいだ**に同じメールアドレスの
// アカウントを入れ、表の UNIQUE が投げる例外を手続きが受けているかを見る。
// 受けていないと、先に登録した人は 409、後から登録した人は 500 と応答が割れる
// （タスク4の監査の指摘 F1・反論役も AGREE）。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeCtx, type Ctx } from "../../../tests/acceptance/v2/_fakes";
import type { Deps } from "../ports";
import { registerStore } from "./registerStore";

const EMAIL = "race@example.com";
const INPUT = { name: "同時の店", email: EMAIL, password: "store-pass-1234", humanToken: "tok-ok" };

let ctx: Ctx;

beforeAll(async () => {
  ctx = await makeCtx();
});

afterAll(async () => {
  await ctx.dispose();
});

/** 先回りの確かめと書き込みのあいだ（＝パスワードを固める最初の待ち）に1回だけ割り込む deps。 */
const depsInterruptedOnce = (during: () => Promise<void>): Deps => {
  let done = false;
  return {
    ...ctx.deps,
    hasher: {
      sha256Hex: (input: string) => ctx.deps.hasher.sha256Hex(input),
      derive: async (password: string, salt: string, iterations: number) => {
        if (!done) {
          done = true;
          await during();
        }
        return ctx.deps.hasher.derive(password, salt, iterations);
      },
    },
  };
};

describe("店の登録の、同じメールアドレスの重なり", () => {
  it("先回りの確かめで見つかれば、書き込む前に断る", async () => {
    const first = await registerStore(ctx.deps, { ...INPUT, email: "taken@example.com" });
    expect(first.ok).toBe(true);
    const second = await registerStore(ctx.deps, { ...INPUT, email: "taken@example.com" });
    expect(second).toEqual({ ok: false, kind: "email_taken" });
  });

  it("先回りの確かめをすり抜けても、表の UNIQUE の例外を受けて同じ断りへ倒れる（500 にしない）", async () => {
    const sneakIn = async () => {
      await registerStore(ctx.deps, INPUT);
    };
    const result = await registerStore(depsInterruptedOnce(sneakIn), INPUT);
    expect(result).toEqual({ ok: false, kind: "email_taken" });
    const accounts = await ctx.db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE email = ?1").bind(EMAIL).all();
    expect((accounts.results[0] as { n: number }).n).toBe(1);
  });

  it("メールアドレスの重複でない落ち方は握りつぶさず、そのまま上へ返す", async () => {
    // D1 の物は関数を自分の持ち物として持たないので、広げずに1つずつ渡し直す。
    const broken: Deps = {
      ...ctx.deps,
      db: {
        prepare: (sql: string) => ctx.deps.db.prepare(sql),
        batch: async () => Promise.reject(new Error("D1_ERROR: network is down")),
      } as unknown as Deps["db"],
    };
    await expect(registerStore(broken, { ...INPUT, email: "other@example.com" })).rejects.toThrow(/network is down/);
  });
});
