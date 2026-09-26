-- メールアドレスの確認（2026-09-22 に枝 feat/email-verify で 0003 として足し、2026-09-26 に 0015 へ付け替えて取り込んだ）。
-- 本番には当たっていない（付け替える前の 0003 も本番に当てたことは無い）。0013・0014 は並列の別の作業が使う。
-- accounts に「確認した時刻」の列を足すだけで、前からある行は1つも変わらない（NULL＝まだ確認していない）。
-- 確認は何もブロックしない——ログイン・公開・変更のどれにも条件を足さない（表示にだけ使う）。
ALTER TABLE accounts ADD COLUMN email_verified_at TEXT;

-- 確認のリンクの控え。平文の token は表に置かず sha256 だけを置く（sessions と同じ置き方）。
-- 同じアカウントの行は1つに保つ（発行し直したら古い行は消す・手続きが行う）。
CREATE TABLE email_verifications (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  email TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_email_verifications_account ON email_verifications(account_id);
