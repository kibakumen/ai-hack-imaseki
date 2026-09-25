-- 確保の行に受け取った時点の電話番号を写す列と、店・記録の読み取りの索引（2026-09-25 監査の指摘 安全-17・設計-08）。
--
-- ⚠️ 0001〜0003 は本番に当たっているので書き換えない（適用済みの migration は編集しない）。
-- ⚠️ 本番へ出す前に、この migration を本番の D1 へ当てる（web/package.json の deploy が先に当てる・設計-01）。
--    当てずに新しいコードだけを出すと、受け取りと店のホームが customer_phone の列を探して500になる。

-- ---------- 受け取った時点の電話番号（安全-17 の案1） ----------
-- それまで店の一覧は、読むたびにその客の**今の**番号を引いていた。昼に店Aで番号なしで受け取って完了し、
-- 夜に店Bのために番号を入れると、店Aの「済んだぶん」にも翌日の昼までその番号が出た。
-- これからは受け取りの1文がその時点の番号をここへ写し、店の一覧はこの写しだけを読む。登録の消去は写しも空にする。
ALTER TABLE reservations ADD COLUMN customer_phone TEXT;

-- 当てた時点で、店の一覧に出ていて番号が要る行（確保中・期限切れ・店が取り消した行）だけ、今の番号で埋める。
-- 完了済みの行は埋めない——その行へ番号を出し続けることが、この直しが止めたかった広がりそのものなので。
-- 消した客（deleted_at が在る）の行は埋めない。
UPDATE reservations
  SET customer_phone = (SELECT c.phone FROM customers c WHERE c.id = reservations.customer_id AND c.deleted_at IS NULL)
  WHERE status IN ('active', 'store_cancelled');

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
-- 店ごとの公開中（店のホーム・公開の二重の確かめ・運営の一覧・取得の候補〔店から入る〕）と、全体の公開中
-- （運営の画面のいちばん上の「公開中」の数）の2つの引き方がある。
CREATE INDEX IF NOT EXISTS idx_offers_open_by_store ON offers(store_id, until_at) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_offers_open_until ON offers(until_at) WHERE ended_at IS NULL;

-- 取得の候補を起点の周りの四角形（domain/geo.searchBounds）で先に絞るための、店の緯度経度の索引。
-- 四角形の条件を SQL に足しただけでは、計画は公開中のオファーの索引から入り、全国の公開中のオファーと
-- その確保を読んだあとで四角形に当たっていた（2026-09-25 のレビューの指摘）。repo/fetchCandidates は
-- CROSS JOIN で店から入る順に固定し、この索引の lat の範囲から引く。
CREATE INDEX IF NOT EXISTS idx_stores_lat_lng ON stores(lat, lng);
