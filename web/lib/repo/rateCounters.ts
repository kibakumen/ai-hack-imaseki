// 連打の抑止（要件30【最終日】）が数を置く rate_counters への読み書き。
// 表の形は 0003_rate_counters_atomic.sql の（key が主キー・window_start・count）で、1つの鍵につき行は1つ。
//
// **数えは1つの文で行う**（2026-09-25 監査の指摘 安全-02）。以前は「読む → 手元で +1 → 消して入れ直す」の
// 2往復で、同時に来た要求がどれも同じ回数を読み、どれも通った。今は `INSERT … ON CONFLICT … RETURNING` の
// 1文が「窓の外なら1から数え直す／窓の中なら1足す」を決めて足した結果を返すので、同時に N 本来ても
// 返る回数は 1, 2, …, N と必ず別々になる（上限を超えた分だけが断られる）。
//
// 時刻は ISO 8601 の文字列（`Date.toISOString()` の24字）で、窓の中かどうかは文字列の大小で比べる
// ——同じ書式なので辞書順と時刻の順が一致する。「今」は呼ぶ側が束縛する（SQLite の datetime('now') は使わない）。

import type { Deps } from "../ports";

type Db = Deps["db"];

/** その鍵の今の数え（窓の始まりと回数）。 */
export type RateCounterRow = { windowStartIso: string; count: number };

export type RateHit = {
  /** 今の時刻（ISO 8601） */
  nowIso: string;
  /** 窓の長さ（ミリ秒）。窓の始まりがこれより古ければ、新しい窓として1から数え直す */
  windowMs: number;
  /** 上限。ちょうど上限に届いた回だけ、窓の始まりをその時刻へ貼り直す（そこから窓の長さだけ断るため） */
  limit: number;
};

/** 窓が終わっている（または読めない）行か。?2 が今・?3 が「今 − 窓の長さ」。 */
const WINDOW_OVER = `(rate_counters.window_start <= ?3 OR rate_counters.window_start > ?2)`;

const HIT_SQL =
  `INSERT INTO rate_counters (key, window_start, count) VALUES (?1, ?2, 1)` +
  ` ON CONFLICT(key) DO UPDATE SET` +
  ` count = CASE WHEN ${WINDOW_OVER} THEN 1 ELSE rate_counters.count + 1 END,` +
  ` window_start = CASE WHEN ${WINDOW_OVER} THEN ?2 WHEN rate_counters.count + 1 = ?4 THEN ?2 ELSE rate_counters.window_start END` +
  ` RETURNING window_start, count`;

/**
 * 1回ぶんを足し、足したあとの数えを返す（1つの文・原子的）。
 *
 * - 行が無い → 1回目として入れる（窓は今から）
 * - 窓の始まりが「今 − 窓の長さ」以前 → 新しい窓の1回目
 * - 窓の始まりが今より後、または日付として読めない値（表が壊れた）→ 新しい窓の1回目
 *   （フェイルオープン・AI判断。断る側へ倒すと、壊れた1行でそのアカウントが永久に入れず、直す手が画面の側に無い。
 *   ISO の文字列は数字で始まるので、数字でない壊れた値は辞書順で「今」より後に並び、ここへ落ちる）
 * - それ以外 → 1足す。足した値がちょうど上限なら窓の始まりを今へ貼り直す（基準 30.4 の「15分間」が
 *   10回目の失敗から15分になる）
 *
 * 上限を超えた回も数は増えるが、窓の始まりは動かさない——断った回で窓が延びると、いつまでも明けない。
 * 呼ぶ側は「返った回数 > 上限」なら断る。
 */
export const hitRateCounter = async (db: Db, key: string, hit: RateHit): Promise<RateCounterRow> => {
  const floorIso = new Date(Date.parse(hit.nowIso) - hit.windowMs).toISOString();
  const row = await db.prepare(HIT_SQL).bind(key, hit.nowIso, floorIso, hit.limit).first();
  return { windowStartIso: String(row?.window_start ?? hit.nowIso), count: Number(row?.count ?? 1) };
};

/**
 * 足した1回ぶんを返す（落ちた要求だけを数える規則で、通った要求の分を取り消す）。
 * 足したときと同じ窓のときだけ引く——窓が変わっていれば、足した分はもう残っていない。
 */
export const refundRateCounter = async (db: Db, key: string, windowStartIso: string): Promise<void> => {
  await db.prepare(`UPDATE rate_counters SET count = count - 1 WHERE key = ?1 AND window_start = ?2 AND count > 0`).bind(key, windowStartIso).run();
};

/** その鍵の数を消す（ログインが通ったとき＝失敗の続きが切れたとき・基準 30.4 の「続く」）。 */
export const deleteRateCounter = async (db: Db, key: string): Promise<void> => {
  await db.prepare(`DELETE FROM rate_counters WHERE key = ?1`).bind(key).run();
};
