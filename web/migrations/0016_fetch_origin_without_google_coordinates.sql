-- 取得の記録の起点から、Google から得た座標を外す（2026-09-26 本人選択・設計-20 の残りの決着）。
--
-- 根拠（一次資料・2026-09-26 取得）: Google Maps Platform Service Specific Terms 6.3.1 は、Geocoding で得た緯度と経度を
-- 連続30日までしか手元に置けないとし、その後は消すことを求める（Places API の緯度と経度も 14.3 で同じ）。期限なしで
-- 置けるのは 6.3.2 の「その客本人向けの機能のためだけ・複数の客に使わない・追加の呼び出しの代わりにしない」場合だけで、
-- 集計のために期限なく残す取得の記録は当たらない。place ID は無期限に置ける。丸めた座標を許す条文は無い。
--
-- それまでは、客が場所の文字で探すと、サーバーが Google で直した座標を fetch_logs.origin_lat/lng に期限なく残していた。
-- このあとは:
--   origin_kind = 'place' … 座標は書かない（NULL）。客が打った文字（origin_place）と、ジオコーディングの応答の
--                           place ID（origin_place_id・応答に無ければ NULL）だけを残す
--   origin_kind = 'here'  … 端末の現在地（ブラウザの位置情報）の座標。Google の中身ではないので今までどおり残す
--
-- ⚠️ **記録の表を「追加だけ」とする基準 27.7 の、1回だけの例外**（2026-09-26 本人選択。requirements.md の要件27 の注）。
--    既にある行の座標のうち Google から来たもの（origin_kind = 'place'）と、どちらから来たか分からないもの
--    （origin_kind が NULL＝migration 0006 より前の行）を消す。現在地で探した行（'here'）の座標は残す。
--    コードの側（lib・app）には、今までどおり記録の表を書き換える文を置かない（構造の検査 27.7 がそこを見張る。
--    この migration は検査の範囲の外で、ここ1回だけ）。
--
-- 列の NOT NULL は SQLite の ALTER TABLE では外せないので、表を作り直す。写すときに、消す座標を NULL にする
-- （UPDATE の文を別に置かない）。
-- fetch_items・selections・ai_calls が fetch_logs(id) を外部の鍵で指しているので、外部の鍵の確かめを
-- このまとまり（トランザクション）の終わりまで遅らせる（D1 の `PRAGMA defer_foreign_keys`）。
-- 並びに意味がある: ①中身を控えの表へ写す ②古い表を落とす（子の行が一時的に宙に浮く）③**同じ名前**で新しい表を作る
-- ④控えから写し戻す（宙に浮いた子の行が、ここで親を見つける）⑤控えを落とす。
-- 「新しい表を別の名前で作って写し、古い表を落として名前を戻す」並び（SQLite の手順書の形）は、D1 では通らない——
-- 遅らせた確かめは、親の表へ行を入れたときにしか解けないので、名前を戻しても宙に浮いたままと数えられる
-- （2026-09-26 に手元の D1 で実測・web/tests/googleOriginMigration.test.ts）。古い表の名前を先に変える並びは、
-- 子の表の定義の指す先まで書き換わるので使わない。

-- ⚠️ 0001・0002 は本番に当たっているので書き換えない（適用済みの migration は編集しない）。
-- ⚠️ 本番へ出す前に、この migration を本番の D1 へ当てる（web/package.json の deploy が先に当てる・設計-01）。
--    当てずに新しいコードだけを出すと、取得の記録を書く文が列の無さで落ちる（origin_place・origin_place_id）。
--    逆に、この migration だけを当てて古いコードのままにしても落ちない（古いコードは座標を書くだけ）。
-- ⚠️ 消した座標は戻せない（控えを取って残すと、同じ利用条件に反する・README 6節の表）。

PRAGMA defer_foreign_keys = on;

CREATE TABLE fetch_logs_0016_copy AS SELECT * FROM fetch_logs;

DROP TABLE fetch_logs;

CREATE TABLE fetch_logs (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  -- 端末の現在地で探したときだけ入る（origin_kind = 'here'）。打った場所で探したときは NULL
  origin_lat REAL,
  origin_lng REAL,
  party INTEGER NOT NULL,
  genres TEXT NOT NULL,
  budget_max INTEGER,
  candidate_count INTEGER NOT NULL,
  returned_count INTEGER NOT NULL,
  ai_used INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  at TEXT NOT NULL,
  origin_kind TEXT CHECK (origin_kind IS NULL OR origin_kind IN ('here', 'place')),
  -- 客が打った場所の文字（origin_kind = 'place' のとき）
  origin_place TEXT,
  -- ジオコーディングの応答の place ID（Google の場所の番号・無期限に置ける）
  origin_place_id TEXT
);

INSERT INTO fetch_logs (id, customer_id, origin_lat, origin_lng, party, genres, budget_max, candidate_count, returned_count, ai_used, duration_ms, at, origin_kind, origin_place, origin_place_id)
  SELECT id, customer_id,
         CASE WHEN origin_kind = 'here' THEN origin_lat END,
         CASE WHEN origin_kind = 'here' THEN origin_lng END,
         party, genres, budget_max, candidate_count, returned_count, ai_used, duration_ms, at, origin_kind, NULL, NULL
  FROM fetch_logs_0016_copy
  ORDER BY rowid;

DROP TABLE fetch_logs_0016_copy;

-- 表を落とすと索引も消えるので、0004 の索引を作り直す（客ごとの取得を時刻で引く・連打の抑止と運営の数字）
CREATE INDEX IF NOT EXISTS idx_fetch_logs_customer_at ON fetch_logs(customer_id, at);
