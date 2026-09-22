// 場所の候補の入口 `GET /api/customer/place-suggest` が、入口として効くことの検査（2026-09-22）。
//
// ⚠️ **なぜここに置いたか**: 受け入れ検査（`tests/acceptance/v2/`）は凍結されていて1文字も変えられない。
// この入口は要件3の外側に足した「入力の補助」なので、`web/tests/`（凍結の外）に置く。
// 見るのは5つ:
//   1. 客として呼ぶと、差し替え口の候補がそのまま返る（最大5件）
//   2. 識別子が無ければ 401（客の入口）
//   3. 短すぎる文字は入力の断り（400・invalid_input）で、外へ聞かない
//   4. 候補の口を持たない差し替え（受け入れ検査の偽物のまま）では 200 の空
//   5. 連打の抑止: 1分に60回を超えると 429（外の地図のサービスを客1人に好きなだけ踏ませない）
//   6. 記録に打った文字が残らない（場所は個人データ）

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeGeocoder, makeCtx, registerCustomer, type Ctx } from "../../tests/acceptance/v2/_fakes";
import type { Geocoder } from "../lib/ports";
import { PLACE_SUGGEST_RATE_LIMIT } from "../lib/schemas/limits";

/**
 * 受け入れ検査の契約（`_types.ts` の `Geocoder`）は凍結されていて `suggest` を知らない。
 * 実物の型（`lib/ports`）で組んでから、場面の道具へ渡すときだけ契約の型へ寄せる。
 */
type ContractGeocoder = Ctx["deps"]["geocoder"];

const SUGGESTED = ["東京都渋谷区渋谷２丁目２４ 渋谷駅", "渋谷区役所", "渋谷ヒカリエ", "渋谷スクランブルスクエア", "渋谷マークシティ", "渋谷ストリーム"];

describe("入口 GET /api/customer/place-suggest", () => {
  let ctx: Ctx;
  const asked: string[] = [];

  beforeAll(async () => {
    const withSuggest: Geocoder = {
      ...(fakeGeocoder() as unknown as Geocoder),
      suggest: async (text) => {
        asked.push(text);
        return { ok: true, source: "geocoding", suggestions: SUGGESTED };
      },
    };
    ctx = await makeCtx({ deps: { geocoder: withSuggest as unknown as ContractGeocoder } });
  });

  afterAll(async () => {
    await ctx.dispose();
  });

  it("客として呼ぶと候補が最大5件返る。文字は差し替え口へそのまま渡る", async () => {
    const { api } = await registerCustomer(ctx);
    const r = await api.get(`/api/customer/place-suggest?q=${encodeURIComponent("渋谷駅")}`);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ suggestions: SUGGESTED.slice(0, 5) });
    expect(asked).toContain("渋谷駅");
  });

  it("識別子が無ければ 401", async () => {
    const r = await ctx.api().get(`/api/customer/place-suggest?q=${encodeURIComponent("渋谷")}`);
    expect(r.status).toBe(401);
    expect(r.json.ok).toBe(false);
  });

  it("短すぎる文字・空は入力の断り（400）で、外へ聞かない", async () => {
    const { api } = await registerCustomer(ctx);
    const before = asked.length;
    for (const q of ["", "渋"]) {
      const r = await api.get(`/api/customer/place-suggest?q=${encodeURIComponent(q)}`);
      expect(r.status, q).toBe(400);
      expect(r.json.error.kind).toBe("invalid_input");
      expect(r.json.error.fields[0].name).toBe("q");
    }
    expect(asked.length).toBe(before);
  });

  it("候補の口を持たない差し替え（受け入れ検査の偽物）では 200 の空——候補は補助で、断りにしない", async () => {
    const plain = await ctx.withDeps({ geocoder: fakeGeocoder() });
    const { api } = await registerCustomer(plain);
    const r = await api.get(`/api/customer/place-suggest?q=${encodeURIComponent("渋谷駅")}`);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ suggestions: [] });
  });

  it(`連打の抑止: 同じ客の ${PLACE_SUGGEST_RATE_LIMIT + 1} 回目は 429 で、差し替え口を呼ばない`, async () => {
    const { api } = await registerCustomer(ctx);
    for (let i = 0; i < PLACE_SUGGEST_RATE_LIMIT; i++) {
      const r = await api.get(`/api/customer/place-suggest?q=${encodeURIComponent("新宿")}`);
      expect(r.status, `${i + 1}回目`).toBe(200);
    }
    const before = asked.length;
    const refused = await api.get(`/api/customer/place-suggest?q=${encodeURIComponent("新宿")}`);
    expect(refused.status).toBe(429);
    expect(refused.json.error.kind).toBe("rate_limited");
    expect(asked.length).toBe(before);
  });

  it("記録に打った文字が残らない（経路の名前だけが残る）", () => {
    const text = JSON.stringify(ctx.logger.entries);
    expect(text).not.toContain("渋谷");
    expect(text).not.toContain("新宿");
    expect(text).toContain("place_suggest.geocoding");
  });
});
