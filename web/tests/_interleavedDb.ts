/* eslint-disable @typescript-eslint/no-explicit-any -- D1 の文を包む検査の道具。包む相手の型は _fakes の Db（any の口）に合わせる */
// 検査の道具: D1 の口を包んで「ある文が走る直前」に別の要求を割り込ませる（2026-09-25 監査の指摘 不具合-13〜16）。
//
// 読んでから書くまでの隙は、人の手では当たりにくい数十ミリ秒しかない。順番を決めて毎回同じ割り込みを
// 再現するための道具で、本番の振る舞いは何も変えない。割り込ませる要求は、包んでいない元の app から送る。
import { apiClient, loadWeb, type Api, type Ctx, type Db } from "../../tests/acceptance/v2/_fakes";

/** 割り込み1つ。`match` の文が走る直前に `before` を1回だけ流す。`armedBy` があれば、その文が1度走ったあとだけ効く。 */
export type Hook = { match: RegExp; before: () => Promise<void>; armedBy?: RegExp };

type WrappedStatement = { __inner: any; __sql: string };

export const interleaved = (db: Db, hooks: Hook[]): Db => {
  const fired = new Set<Hook>();
  const seen: string[] = [];
  const fire = async (sql: string) => {
    for (const hook of hooks) {
      if (fired.has(hook) || !hook.match.test(sql)) continue;
      if (hook.armedBy && !seen.some((s) => hook.armedBy!.test(s))) continue;
      fired.add(hook);
      await hook.before();
    }
    seen.push(sql);
  };
  const wrap = (inner: any, sql: string): any => ({
    __inner: inner,
    __sql: sql,
    bind: (...values: unknown[]) => wrap(inner.bind(...values), sql),
    first: async (...args: unknown[]) => (await fire(sql), inner.first(...args)),
    all: async () => (await fire(sql), inner.all()),
    run: async () => (await fire(sql), inner.run()),
    raw: async (...args: unknown[]) => (await fire(sql), inner.raw(...args)),
  });
  return {
    prepare: (sql: string) => wrap(db.prepare(sql), sql),
    batch: async (statements: any[]) => {
      for (const s of statements as WrappedStatement[]) await fire(s.__sql ?? "");
      return db.batch(statements.map((s: WrappedStatement) => s.__inner ?? s));
    },
    exec: (sql: string) => db.exec(sql),
  };
};

/** 包んだ D1 で組んだ app（ほかの差し替え口は元の場面と同じ偽物）。`api(cookie)` でその app を呼ぶ。 */
export type Wrapped = { api: (cookie: string | null) => Api };
export const wrappedApp = async (ctx: Ctx, hooks: Hook[]): Promise<Wrapped> => {
  const { createApp } = await loadWeb("lib/http/app");
  const app = createApp({ ...ctx.deps, db: interleaved(ctx.db, hooks) });
  return { api: (cookie) => apiClient(app, cookie) };
};

