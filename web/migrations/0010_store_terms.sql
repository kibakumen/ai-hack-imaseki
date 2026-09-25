-- 店向けの利用規約への同意の記録（2026-09-25 監査の指摘 店-21 のレビュー）。
--
-- それまで同意は登録の画面の中だけで持ち、登録の入口は同意なしでも店を作り、同意したことも規約の版も残らなかった
-- （争いになったとき運営に拠り所が無い）。登録の入口が今の版への同意を求め、通った登録は次の2つを残す:
--
--   stores.terms_version   … 同意した店向けの利用規約の版（web/lib/schemas/limits の STORE_TERMS_VERSION・日付の形）
--   stores.terms_agreed_at … 同意した時刻（登録した時刻と同じ）
--
-- この migration より前に登録した店と、デモの種データの店（登録の画面を通らない）は NULL のまま——同意の記録が無い、
-- という事実をそのまま表す（後から埋めない）。
--
-- ⚠️ 0001・0002 は本番に当たっているので書き換えない（適用済みの migration は編集しない）。
-- ⚠️ 本番へ出す前に、この migration を本番の D1 へ当てる（web/package.json の deploy が先に当てる・設計-01）。
--    当てずに新しいコードだけを出すと、店の登録が列の無さで落ちる。

ALTER TABLE stores ADD COLUMN terms_version TEXT;
ALTER TABLE stores ADD COLUMN terms_agreed_at TEXT;
