-- 連打の抑止の数えを1つの原子的な文にするための作り直し（2026-09-25 監査の指摘 安全-02）。
--
-- それまでは「読む（SELECT）→ 手元で +1 → 消してから入れ直す（DELETE と INSERT）」の2往復で、
-- 同時に来た要求がどれも同じ回数を読み、どれも通った（手元の SQLite で30本同時に送って30本とも通った）。
-- 数えを `INSERT … ON CONFLICT(key) DO UPDATE … RETURNING` の1文にするには、鍵（key）だけで
-- 行が1つに決まっていなければならない。0001 の主キーは（key, window_start）だったので、ここで作り直す。
--
-- ⚠️ 0001・0002 は本番に当たっているので書き換えない（適用済みの migration は編集しない）。
-- ⚠️ 本番へ出す前に、この migration を本番の D1 へ当てる（web/package.json の deploy が先に当てる・設計-01）。
--    当てずに新しいコードだけを出すと、ON CONFLICT(key) に当たる一意の制約が無く、全部の数えが500になる。

CREATE TABLE rate_counters_next (
  key TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);

-- 鍵ごとにいちばん新しい窓の行だけを移す（古いコードは鍵ごとに1行しか置かないが、万一2行あっても新しい窓を採る——
-- 古い窓で断り続けないため。旧 repo/rateCounters.ts の findRateCounter と同じ選び方）。
INSERT INTO rate_counters_next (key, window_start, count)
  SELECT r.key, r.window_start, r.count
  FROM rate_counters r
  WHERE r.window_start = (SELECT MAX(x.window_start) FROM rate_counters x WHERE x.key = r.key);

DROP TABLE rate_counters;

ALTER TABLE rate_counters_next RENAME TO rate_counters;

-- アプリ全体の1日の AI の上限（安全-03）が、その日の ai_calls を数えるための索引。
-- 名前は他の migration と重ならないよう用途つきにし、IF NOT EXISTS で二重に作っても落ちないようにする。
CREATE INDEX IF NOT EXISTS idx_ai_calls_at_daily_budget ON ai_calls(at);
