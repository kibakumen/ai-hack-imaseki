-- AI の呼び出しの用途（速成版 sprint/migrations/0004_ai_calls.sql の purpose 列を写したもの）。
-- 用途別のコスト内訳（店の選定／紹介文の生成／紹介文の検査）を後から数えるための土台。
-- 列を足すだけで、前からある行は1つも変わらない（既定値 'select'＝この列が無かった頃の呼び出しは全部、店の選定）。
ALTER TABLE ai_calls ADD COLUMN purpose TEXT NOT NULL DEFAULT 'select';

CREATE INDEX idx_ai_calls_purpose ON ai_calls(purpose);
