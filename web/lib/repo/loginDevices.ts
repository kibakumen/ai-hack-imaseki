// 端末の印（ログインに通ったブラウザ）の読み書き（2026-09-25 のレビュー・安全-10 の続き）。
//
// 置き場は連打の抑止の表 rate_counters（新しい表を作らない）。1つの（メールアドレス・印）につき行は1つで、
//   key          … `loginDevice:<揃えたメールアドレス>|<印の SHA-256>`（生の印は置かない）
//   window_start … 最後にそのアカウントへ通った時刻（通るたびに書き直す）
//   count        … 通った回数（読まない。見返すときの手がかり）
// 鍵の前半が `login:` と別なので、締め出しを解く手順（`key LIKE 'login:<email>|%'` を消す・README）には当たらない。
//
// 時刻は ISO 8601 の文字列で、比べるのは文字列の大小（repo/rateCounters と同じ）。「今」は呼ぶ側が束縛する。

import { normalizeLoginEmail } from "../domain/loginDevice";
import type { Deps } from "../ports";

type Db = Deps["db"];

const deviceKey = (email: string, deviceHash: string): string => `loginDevice:${normalizeLoginEmail(email)}|${deviceHash}`;

/** そのアカウントに、この端末で通ったことを書く（通るたびに時刻を書き直す）。 */
export const rememberLoginDevice = async (db: Db, input: { email: string; tokenHash: string; nowIso: string }): Promise<void> => {
  await db
    .prepare(`INSERT INTO rate_counters (key, window_start, count) VALUES (?1, ?2, 1) ON CONFLICT(key) DO UPDATE SET window_start = ?2, count = rate_counters.count + 1`)
    .bind(deviceKey(input.email, input.tokenHash), input.nowIso)
    .run();
};

/**
 * この端末で、そのアカウントに `sinceIso` より後に通ったか。
 * 時刻が今より後の行（表が壊れた・時計が戻った）は信じない——信じる側へ倒すと、壊れた1行で上限が外れ続ける。
 */
export const isKnownLoginDevice = async (db: Db, input: { email: string; tokenHash: string; sinceIso: string; nowIso: string }): Promise<boolean> => {
  const row = await db
    .prepare(`SELECT 1 AS found FROM rate_counters WHERE key = ?1 AND window_start > ?2 AND window_start <= ?3`)
    .bind(deviceKey(input.email, input.tokenHash), input.sinceIso, input.nowIso)
    .first();
  return row !== null;
};
