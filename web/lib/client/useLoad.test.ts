// 読み込みの4つの状態の移り方（監査の指摘 横断-01）。画面の側の検査は components/loadStates.test.tsx。
import { describe, expect, it } from "vitest";
import type { ApiFailure } from "./api";
import { nextLoadState, type LoadState } from "./useLoad";

const FAILED: ApiFailure = { ok: false, error: { kind: "network" } };
const isEmpty = (items: string[]) => items.length === 0;

describe("nextLoadState", () => {
  it("1度も取れていないまま失敗したら failed（0件にはしない）", () => {
    expect(nextLoadState<string[]>({ status: "loading" }, FAILED, 1, isEmpty)).toEqual({ status: "failed", failure: FAILED });
  });

  it("取れて0件なら empty、中身があれば ready", () => {
    expect(nextLoadState<string[]>({ status: "loading" }, [], 1, isEmpty)).toMatchObject({ status: "empty", data: [] });
    expect(nextLoadState<string[]>({ status: "loading" }, ["a"], 1, isEmpty)).toMatchObject({ status: "ready", data: ["a"], updatedAt: 1, refreshFailure: null });
  });

  it("取れたあとの取り直しが失敗したら、前の中身と時刻を残して refreshFailure を立てる。次に取れれば消える", () => {
    const ready: LoadState<string[]> = { status: "ready", data: ["a"], updatedAt: 1, refreshFailure: null };
    const stale = nextLoadState(ready, FAILED, 2, isEmpty);
    expect(stale).toEqual({ status: "ready", data: ["a"], updatedAt: 1, refreshFailure: FAILED });
    expect(nextLoadState(stale, ["a", "b"], 3, isEmpty)).toEqual({ status: "ready", data: ["a", "b"], updatedAt: 3, refreshFailure: null });
  });

  it("failed のあとに取れれば ready（読み直しで直る）", () => {
    expect(nextLoadState<string[]>({ status: "failed", failure: FAILED }, ["a"], 5, isEmpty)).toMatchObject({ status: "ready", updatedAt: 5 });
  });
});
