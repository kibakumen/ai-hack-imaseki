-- Google の地図サービスの利用条件に沿わせるための2列（2026-09-25 監査の指摘 設計-20 の案1）。
--
-- 利用条件（Google Maps Platform Service Specific Terms の Geocoding API の項）は、Geocoding で得た緯度と経度を
-- 「連続30日まで」しか手元に置けないとしている（place ID は無期限で置ける）。それまでは店の座標も取得の起点も
-- 期限なく置いていた。どの座標が Google から来たかを見分けるために、2つの列を足す。
--
--   stores.geocoded_at        … 店の住所を Google で位置に直した時刻（店の情報の保存のとき）。NULL は「Google から
--                                来た座標ではない（デモの店の手で置いた座標）か、この migration より前に保存した座標」。
--                                手入れ（lib/usecases/googleUpkeep）は25日を過ぎた座標を取り直し、取り直せないまま
--                                30日を過ぎたら座標を消す。
--   fetch_logs.origin_source  … 取得の起点の出どころ。'place'（客が打った場所の文字を Google で位置に直した）／
--                                'device'（端末の現在地）。NULL はこの migration より前の行（どちらか分からない）。
--                                手入れは 'place' と NULL の行を、30日を過ぎたら約1km（小数2桁）に丸める。
--
-- ⚠️ 0001・0002 は本番に当たっているので書き換えない（適用済みの migration は編集しない）。
-- ⚠️ 本番へ出す前に、この migration を本番の D1 へ当てる（web/package.json の deploy が先に当てる・設計-01）。
--    当てずに新しいコードだけを出すと、取得の記録と店の情報の保存が列の無さで落ち、探すのが全部500になる。

ALTER TABLE stores ADD COLUMN geocoded_at TEXT;
ALTER TABLE fetch_logs ADD COLUMN origin_source TEXT;
