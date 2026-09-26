-- 店の取り消しの「来ない（枠を戻す）」（2026-09-26 本人選択・安全-06 の残り・要件18の基準 18.4 の変更と 18.16・要件21の基準 21.8）。
--
-- 客が識別子を作り直して受け取り直すと、1つの回線で席を押さえ続けられた。店の側の対抗手段として、確保中の客が期限内でも
-- 来ないと店が判断したら「来ない」で取り消し、その枠を残りへ戻す（holds_slot を 0 にする）。状態の語は増やさず
-- store_cancelled のままにして、理由だけを列に持つ（NULL＝店の都合・'no_show'＝来店なし）。
--
-- ① reservations.cancel_reason … 客の画面の文・店の一覧の印・運営の数字が読む
-- ② reservation_events.reason  … 状態の変化の記録（要件27の追加だけの表）に理由を残す。既にある行は NULL のまま（書き換えない・基準 27.7）
--
-- 既にある store_cancelled の行は holds_slot が 1（既定値のまま）なので、枠の数え方（sqlFragments.holdsSlotCondition）を
-- 「store_cancelled かつ holds_slot = 1」に変えても、今の残りは1つも動かない。
ALTER TABLE reservations ADD COLUMN cancel_reason TEXT;
ALTER TABLE reservation_events ADD COLUMN reason TEXT;
