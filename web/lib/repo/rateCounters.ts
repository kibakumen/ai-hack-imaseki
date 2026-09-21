// 連打の抑止（要件30【最終日】）が数を置く rate_counters への読み書き。
// 表の形は 0001_init.sql の（key・window_start・count）で、**1つの鍵につき行は1つだけ**置く
// ——窓を貼り直すときは消してから入れるので、古い窓の行が溜まらない（掃除の手続きが要らない）。
// 時刻は ISO 8601 の文字列で、窓の中かどうかの判定は呼ぶ側が束縛した「今」で行う
// （SQLite の datetime('now') は使わない・実行者への契約）。

import type { Deps } from "../ports";

type Db = Deps["db"];

/** その鍵の今の数え（窓の始まりと回数）。 */
export type RateCounterRow = { windowStartIso: string; count: number };

/**
 * その鍵の行を1つ引く。無ければ null。
 * 行は1つだけのはずだが、万一2つ在っても新しい窓を採る（古い窓で断り続けないため）。
 */
export const findRateCounter = async (db: Db, key: string): Promise<RateCounterRow | null> => {
  const row = await db
    .prepare(`SELECT window_start, count FROM rate_counters WHERE key = ?1 ORDER BY window_start DESC LIMIT 1`)
    .bind(key)
    .first();
  if (!row) return null;
  return { windowStartIso: String(row.window_start ?? ""), count: Number(row.count ?? 0) };
};

/** その鍵の行を、渡した1行だけに置き換える（消してから入れるので、窓の貼り直しも同じ道で書ける）。 */
export const saveRateCounter = async (db: Db, key: string, counter: RateCounterRow): Promise<void> => {
  await db.batch([
    db.prepare(`DELETE FROM rate_counters WHERE key = ?1`).bind(key),
    db.prepare(`INSERT INTO rate_counters (key, window_start, count) VALUES (?1, ?2, ?3)`).bind(key, counter.windowStartIso, counter.count),
  ]);
};

/** その鍵の数を消す（ログインが通ったとき＝失敗の続きが切れたとき・基準 30.4 の「続く」）。 */
export const deleteRateCounter = async (db: Db, key: string): Promise<void> => {
  await db.prepare(`DELETE FROM rate_counters WHERE key = ?1`).bind(key).run();
};
