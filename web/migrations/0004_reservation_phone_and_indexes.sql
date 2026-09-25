-- 店・記録の読み取りの索引（2026-09-25 監査の指摘 設計-08）。
--
-- ⚠️ 0001〜0003 は本番に当たっているので書き換えない（適用済みの migration は編集しない）。
-- ⚠️ 本番へ出す前に、この migration を本番の D1 へ当てる（web/package.json の deploy が先に当てる・設計-01）。
--    当てずに新しいコードだけを出しても落ちはしないが、店の画面が30秒ごとに表を全部読む形のまま残る。

-- ---------- 索引（設計-08） ----------
-- EXPLAIN QUERY PLAN で表全体の走査（SCAN）を確かめた読み取りに当てる。名前は用途つきにし、IF NOT EXISTS で
-- 二重に作っても落ちないようにする（0003 と同じ書き方）。

-- 店のホーム（30秒ごと）の一覧と期限切れの記録の足し込み・店の実績・運営の一覧の受け取り実績（店で絞り、時刻で切る）
CREATE INDEX IF NOT EXISTS idx_reservations_store_status_at ON reservations(store_id, status_at);

-- 店の実績の「取得の結果に出た回数」（その店が出た取得を引く）
CREATE INDEX IF NOT EXISTS idx_fetch_items_store ON fetch_items(store_id);

-- 客の最後の取得の時刻（客のホーム）
CREATE INDEX IF NOT EXISTS idx_fetch_logs_customer_at ON fetch_logs(customer_id, at);

-- 公開中のオファーだけに効く部分索引（終わったオファーは溜まる一方で、読む側はほとんど公開中しか見ない）。
-- 店ごとの公開中（店のホーム・公開の二重の確かめ・運営の一覧）と、全体の公開中（取得の候補）の2つの引き方がある。
CREATE INDEX IF NOT EXISTS idx_offers_open_by_store ON offers(store_id, until_at) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_offers_open_until ON offers(until_at) WHERE ended_at IS NULL;
