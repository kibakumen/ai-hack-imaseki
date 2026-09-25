// 実物の Deps の組み立て（adapters/deps）。外へは1バイトも出さず、組み立てた口の有無だけを見る。
import { describe, expect, it } from "vitest";
import { createDeps } from "./deps";

/** 束縛の形だけを満たす偽物（中身は呼ばない） */
const BINDINGS = { DB: { prepare: () => ({}) }, PERMITS: { put: async () => {}, get: async () => null, delete: async () => {} } };

describe("実物の Deps の組み立て", () => {
  it("応答のあとも仕事を生かしておく口（ctx.waitUntil）を渡すと deps.defer になり、渡さなければ持たない（設計-17）", () => {
    const kept: Array<Promise<unknown>> = [];
    const waitUntil = (task: Promise<unknown>): void => {
      kept.push(task);
    };
    const withDefer = createDeps(BINDINGS, waitUntil);
    const task = Promise.resolve("done");
    withDefer.defer?.(task);
    expect(kept).toEqual([task]);
    expect(createDeps(BINDINGS).defer).toBeUndefined();
  });

  it("束縛が無ければ黙って倒さずに投げる", () => {
    expect(() => createDeps({ PERMITS: BINDINGS.PERMITS })).toThrow(/DB/);
    expect(() => createDeps({ DB: BINDINGS.DB })).toThrow(/PERMITS/);
  });
});
