// カードの登録の口の実物（2026-09-25 カード登録の自動の確かめのレビュー）。
//
// 決済会社のセッションは、入力を終えないまま24時間たつと expired になる。それまでは「確かめられなかった」と
// 同じ形で返していたので、控えの番号が永久に残り、画面を開くたびに決済会社へ問い合わせ続けていた。
// expired だけを見分けて返し、呼ぶ側（usecases/card）が控えを消す。

import { describe, expect, it } from "vitest";
import { createCardRegistrar } from "./stripe";

/** 決まった本文を返す偽の fetch。呼ばれた道を覚える。 */
const answering = (body: unknown, status = 200) => {
  const paths: string[] = [];
  const fetch = (async (input: RequestInfo | URL) => {
    paths.push(new URL(String(input)).pathname);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;
  return { fetch, paths };
};

describe("adapters/stripe の confirmSetup", () => {
  it("入力を終えた（complete）なら、どの店の口だったかを返す", async () => {
    const { fetch, paths } = answering({ id: "cs_1", status: "complete", client_reference_id: "store-1" });
    expect(await createCardRegistrar({ secretKey: "sk_test_x", fetch }).confirmSetup("cs_1")).toEqual({ ok: true, clientReference: "store-1" });
    expect(paths).toEqual(["/v1/checkout/sessions/cs_1"]);
  });

  it("期限が切れた（expired）ことは見分けて返す（呼ぶ側が控えを消す）", async () => {
    const { fetch } = answering({ id: "cs_1", status: "expired", client_reference_id: "store-1" });
    expect(await createCardRegistrar({ secretKey: "sk_test_x", fetch }).confirmSetup("cs_1")).toEqual({ ok: false, expired: true });
  });

  it("まだ入力の途中（open）・問い合わせの失敗は、期限切れとは言わない（控えを残す）", async () => {
    const open = answering({ id: "cs_1", status: "open", client_reference_id: "store-1" });
    expect(await createCardRegistrar({ secretKey: "sk_test_x", fetch: open.fetch }).confirmSetup("cs_1")).toEqual({ ok: false });
    const failed = answering({ error: { message: "boom" } }, 500);
    expect(await createCardRegistrar({ secretKey: "sk_test_x", fetch: failed.fetch }).confirmSetup("cs_1")).toEqual({ ok: false });
  });
});
