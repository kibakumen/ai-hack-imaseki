-- 店の座標を Google で位置に直した時刻の列（2026-09-25 監査の指摘 設計-20 の案1）。
--
-- 利用条件（Google Maps Platform Service Specific Terms の Geocoding API の項）は、Geocoding で得た緯度と経度を
-- 「連続30日まで」しか手元に置けないとしている（place ID は無期限で置ける・確度は推測。本人が一次資料で確かめる）。
-- それまでは店の座標を期限なく置いていた。どの座標が Google から来たか・いつ取ったかを見分けるために列を足す。
--
--   stores.geocoded_at … 店の住所を Google で位置に直した時刻（店の情報の保存のとき）。NULL は「Google から
--                         来た座標ではない（デモの店の手で置いた座標）か、座標が無い」。
--                         手入れ（lib/usecases/googleUpkeep）は25日を過ぎた座標を取り直し、取り直せないまま
--                         30日を過ぎたら座標を消す。
--
-- 取得の起点（fetch_logs.origin_lat/lng）も、客が打った場所なら Google から来た座標だが、ここでは扱わない。
-- 記録の表を追加だけにする基準 27.7 を、本人選択で緩めないと決めている（要件27 の補足）。本人の判断待ち。
--
-- ⚠️ 0001・0002 は本番に当たっているので書き換えない（適用済みの migration は編集しない）。
-- ⚠️ 本番へ出す前に、この migration を本番の D1 へ当てる（web/package.json の deploy が先に当てる・設計-01）。
--    当てずに新しいコードだけを出すと、店の情報の保存が列の無さで落ちる。

ALTER TABLE stores ADD COLUMN geocoded_at TEXT;

-- この migration より前に、店の画面の保存（Google で位置に直した）で座標を置いた店も、手入れの対象へ入れる
-- （2026-09-25 設計-20 のレビュー: 取った時刻が無いと手入れに選ばれず、座標が期限なく残った）。
-- いつ取ったかは残っていないので、店の登録の時刻で埋める——座標は登録より前には取れないので、実際より若く見積もらない。
-- デモの店（種データ web/scripts/seed-demo.mjs の店・メールアドレスが @example.com）は座標を手で置いているので埋めない。
-- ⚠️ 本番のデモの店のメールアドレスが @example.com かは、当てる前に本人が確かめる（README の6節に読むだけの確かめ方）。
UPDATE stores SET geocoded_at = created_at
  WHERE geocoded_at IS NULL
    AND lat IS NOT NULL AND lng IS NOT NULL
    AND address IS NOT NULL AND address <> ''
    AND id NOT IN (SELECT store_id FROM accounts WHERE store_id IS NOT NULL AND email LIKE '%@example.com');
