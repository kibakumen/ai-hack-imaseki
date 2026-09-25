// 店向けの利用規約の版（2026-09-25 監査の指摘 店-21 のレビュー）。受け入れ検査の場面づくりが送る版は、入口と画面の正本と
// 同じでなければならない（ずれると、場面づくりの店の登録が全部断られる）。
import { describe, expect, it } from "vitest";
import { STORE_TERMS_AGREEMENT } from "../../../tests/acceptance/v2/_fakes";
import { STORE_TERMS_VERSION } from "./limits";

describe("店向けの利用規約の版", () => {
  it("日付の形で、受け入れ検査の場面づくりが送る版と同じ（規約の版を上げたら、場面づくりの版も上げる）", () => {
    expect(STORE_TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(STORE_TERMS_AGREEMENT.agreedTermsVersion).toBe(STORE_TERMS_VERSION);
  });
});
