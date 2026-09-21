// プッシュのための D1 の読み書き（設計書「ファイル構成の計画」: lib/repo は D1 の SQL）。
// 持つのは2つ——①購読の表 push_subscriptions（客1人に1つ＝端末1台が客1人・設計書「データと状態」）
// ②文面の場面を決めるための、その客の最後の確保の状態の読み取り（**読むだけ**。確保の表への
// 書き込みはタスク13・17・18・21 の持ち場）。
// 購読に置くのは配信元の URL と鍵だけで、呼び名も電話番号も入らない（基準 22.5）。

import type { Deps } from "../ports";

type Db = Deps["db"];

/** 購読の配信元の URL（端末の見分け）。形が違えば null＝端末を見分けられない。 */
const endpointOf = (subscription: unknown): string | null => {
  const endpoint = (subscription as { endpoint?: unknown } | null)?.endpoint;
  return typeof endpoint === "string" && endpoint !== "" ? endpoint : null;
};

/**
 * 同じ客が送り直したら入れ替える（客1人に1つ）。
 *
 * **同じ端末が別の客として送ってきたら、前の客の購読は消す**（設計書「データと状態」の
 * `push_subscriptions` の行「端末1台＝客1人」）。1台の端末に2人ぶんの購読が残ると、登録を
 * やり直した客の端末へ前の登録あての知らせが届き続ける。端末の見分けは配信元の URL
 * （`endpoint`）で、鍵は見ない——配信元が鍵だけを更新することがある。
 */
export const savePushSubscription = async (db: Db, customerId: string, subscription: unknown): Promise<void> => {
  const json = JSON.stringify(subscription);
  const endpoint = endpointOf(subscription);
  const save = db
    .prepare(`INSERT INTO push_subscriptions (customer_id, subscription_json) VALUES (?1, ?2) ON CONFLICT (customer_id) DO UPDATE SET subscription_json = ?2`)
    .bind(customerId, json);
  if (endpoint === null) {
    await save.run();
    return;
  }
  // 消してから入れる。同じまとまりで流すので、2人ぶんが同時に見える瞬間を作らない。
  await db.batch([
    db.prepare(`DELETE FROM push_subscriptions WHERE customer_id <> ?1 AND json_extract(subscription_json, '$.endpoint') = ?2`).bind(customerId, endpoint),
    save,
  ]);
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
