// プッシュのための D1 の読み書き（設計書「ファイル構成の計画」: lib/repo は D1 の SQL）。
// 持つのは2つ——①購読の表 push_subscriptions（客1人に1つ＝端末1台が客1人・設計書「データと状態」）
// ②文面の場面を決めるための、その客の最後の確保の状態の読み取り（**読むだけ**。確保の表への
// 書き込みはタスク13・17・18・21 の持ち場）。
// 購読に置くのは配信元の URL と鍵だけで、呼び名も電話番号も入らない（基準 22.5）。

import type { Deps } from "../ports";

type Db = Deps["db"];

/** 同じ客が送り直したら入れ替える（客1人に1つ）。 */
export const savePushSubscription = async (db: Db, customerId: string, subscription: unknown): Promise<void> => {
  await db
    .prepare(`INSERT INTO push_subscriptions (customer_id, subscription_json) VALUES (?1, ?2) ON CONFLICT (customer_id) DO UPDATE SET subscription_json = ?2`)
    .bind(customerId, JSON.stringify(subscription))
    .run();
};

/** 通知を許可していない客は null（呼ぶ側は送信を試みない・基準 22.7）。壊れた JSON も null。 */
export const findPushSubscription = async (db: Db, customerId: string): Promise<unknown | null> => {
  const row = await db.prepare(`SELECT subscription_json FROM push_subscriptions WHERE customer_id = ?1`).bind(customerId).first();
  const raw = (row as { subscription_json?: unknown } | null)?.subscription_json;
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

/** 配信元が「もう無い」と答えた購読を消す（基準 22.6）。 */
export const deletePushSubscription = async (db: Db, customerId: string): Promise<void> => {
  await db.prepare(`DELETE FROM push_subscriptions WHERE customer_id = ?1`).bind(customerId).run();
};

/** その客が通知を許可済みか（許可を求めるかの判定に使う・基準 22.8・22.11）。 */
export const hasPushSubscription = async (db: Db, customerId: string): Promise<boolean> => {
  const row = await db.prepare(`SELECT 1 AS found FROM push_subscriptions WHERE customer_id = ?1`).bind(customerId).first();
  return row !== null && row !== undefined;
};

/**
 * その客の**いちばん新しい**確保の状態（無ければ null）。文面の場面を決めるのに使う。
 * 新しい確保を受け取り直した客には、古い取り消しの文面を返さない——だから状態で絞らず、
 * 最後の1件を取ってから場面に直す（判断は usecases/pushMessage）。
 */
export const findLatestReservationStatus = async (db: Db, customerId: string): Promise<string | null> => {
  const row = await db
    .prepare(`SELECT status FROM reservations WHERE customer_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT 1`)
    .bind(customerId)
    .first();
  const status = (row as { status?: unknown } | null)?.status;
  return typeof status === "string" ? status : null;
};
