// カードの登録の確かめ（2026-09-25 カード登録の自動の確かめのレビュー）。
//
// 登録を始めて入力を終えなかった店（キャンセルした・決済会社のセッションが24時間で expired になった）は、
// 確かめに失敗しても控え（card_setup_session_id）が消えず、ホームや書類の画面を開くたびに決済会社へ問い合わせ、
// 開始と同じ回数の制限を使い切って、本当に押した「カードを登録する」まで断られた。
// **期限が切れたと分かったときだけ**控えを消す（入力の途中・問い合わせの失敗では消さない）。

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeCtx, registerStore, type Ctx } from "../../../tests/acceptance/v2/_fakes";
import type { CardRegistrar, Deps } from "../ports";
import { findCardSetupSession, saveCardSetupSession } from "../repo/stores";
import { confirmCardSetup } from "./card";

let ctx: Ctx;

beforeAll(async () => {
  ctx = await makeCtx();
});
afterAll(async () => {
  await ctx.dispose();
});

/** 店を1つ作り、カードの登録を始めたところまで進める（控えの番号が在る）。 */
const startedStore = async () => {
  const store = await registerStore(ctx);
  expect((await store.api.post("/api/store/card/setup", {})).status).toBe(200);
  const sessionId = await findCardSetupSession(ctx.db, store.id);
  expect(sessionId).not.toBeNull();
  return { store, sessionId: sessionId! };
};

const withCard = (confirmSetup: CardRegistrar["confirmSetup"]): Deps => ({ ...ctx.deps, card: { ...ctx.deps.card, confirmSetup } }) as Deps;

describe("usecases/card の confirmCardSetup", () => {
  it("決済会社のセッションの期限が切れていたら、控えを消して断る（以後は自動の確かめが決済会社を呼ばない）", async () => {
    const { store } = await startedStore();
    expect(await confirmCardSetup(withCard(async () => ({ ok: false, expired: true })), store.id)).toEqual({ ok: false });
    expect(await findCardSetupSession(ctx.db, store.id)).toBeNull();
    expect((await store.api.get("/api/store/home")).json.cardSetupPending).toBe(false);
  });

  it("入力の途中・問い合わせの失敗では控えを残す（戻ってきたときに確かめられるように）", async () => {
    const { store, sessionId } = await startedStore();
    expect(await confirmCardSetup(withCard(async () => ({ ok: false })), store.id)).toEqual({ ok: false });
    expect(await findCardSetupSession(ctx.db, store.id)).toBe(sessionId);
  });

  it("確かめている間に店が登録をやり直した（控えが新しい番号に変わった）ら、新しい控えは消さない", async () => {
    const { store } = await startedStore();
    const expiredWhileRestarted: CardRegistrar["confirmSetup"] = async () => {
      await saveCardSetupSession(ctx.db, store.id, "cs_restarted");
      return { ok: false, expired: true };
    };
    expect(await confirmCardSetup(withCard(expiredWhileRestarted), store.id)).toEqual({ ok: false });
    expect(await findCardSetupSession(ctx.db, store.id)).toBe("cs_restarted");
  });
});
