// カードの登録（要件13の基準 13.6・13.7・13.8・13.9）。外の画面へ移る口を開くのと、
// 戻ってきた店の結果を確かめるのの2つ。カードの番号・有効期限・確認の番号はここを通らない（基準 13.7）。

import type { Deps } from "../ports";
import { markCardRegistered, saveCardSetupSession } from "../repo/stores";

export type CardSetupResult = { ok: true; url: string } | { ok: false };

/**
 * カードの登録の口を開く。外のサービスが断ったら何も書かない（入口が `card_setup_failed` で断る）。
 * 応答に出すのは移り先の URL だけで、受け皿の番号も鍵も画面へ渡さない。
 */
export const startCardSetup = async (deps: Deps, storeId: string, returnUrl: string): Promise<CardSetupResult> => {
  const session = await deps.card.createSetupSession({ storeId, returnUrl });
  if (!session.ok) return { ok: false };
  // 戻ってきた要求を突き合わせるために番号だけ控える（カードの値は控えない）。
  await saveCardSetupSession(deps.db, storeId, session.sessionId);
  return { ok: true, url: session.url };
};

export type CardConfirmResult = { ok: true } | { ok: false };

/**
 * 戻ってきた店の結果を外のサービスに確かめる。確かめが取れない・別の店の口だった場合は
 * 登録済みにしない（基準 13.9・13.6）——番号を知っているだけの要求で他店を登録済みにできてはいけない。
 */
export const confirmCardSetup = async (deps: Deps, storeId: string, sessionId: string): Promise<CardConfirmResult> => {
  const confirmed = await deps.card.confirmSetup(sessionId);
  if (!confirmed.ok || confirmed.clientReference !== storeId) return { ok: false };
  await markCardRegistered(deps.db, storeId, deps.clock.now().toISOString());
  return { ok: true };
};
