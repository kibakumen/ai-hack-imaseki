-- 運営の判断材料と記録（2026-09-25 監査の指摘 運営-01・運営-02・運営-05）。
--
-- ⚠️ 0001・0002 は本番に当たっているので書き換えない（適用済みの migration は編集しない）。
-- ⚠️ 本番へ出す前に、この migration を本番の D1 へ当てる（当てずに新しいコードだけを出すと、
--    運営の操作が admin_actions・stores の新しい列を探して 500 になる）。

-- ---------- 運営の操作の記録（運営-01） ----------
-- 承認・取り消し・戻す・仮のパスワードの発行・許可書の閲覧・運営のメモ・承認後の変更の確かめを、
-- 「誰が（actor_account_id）・いつ（at）・なぜ（reason）」つきで1行ずつ残す。**追加だけの表**——
-- 書き換えと消去は下のトリガーが断る（店から「なぜ止められたのか」と問われたとき、後から直した記録を見せない）。
-- 客を指す値は置かない（detail は数だけの JSON。例: 取り消した確保の数・通知を送った人数）。
CREATE TABLE admin_actions (
  id TEXT PRIMARY KEY,
  actor_account_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('approve', 'ban', 'restore', 'temp_password', 'view_license', 'note', 'acknowledge')),
  store_id TEXT NOT NULL,
  reason TEXT,
  detail TEXT,
  at TEXT NOT NULL
);

CREATE INDEX idx_admin_actions_store ON admin_actions(store_id, at);

CREATE TRIGGER admin_actions_no_update BEFORE UPDATE ON admin_actions
BEGIN
  SELECT RAISE(ABORT, 'admin_actions is append-only');
END;

CREATE TRIGGER admin_actions_no_delete BEFORE DELETE ON admin_actions
BEGIN
  SELECT RAISE(ABORT, 'admin_actions is append-only');
END;

-- ---------- 承認した時点の写し（運営-02 の案2） ----------
-- 承認は保ったまま、承認した時点の店名・住所・営業許可書の鍵を写して残す。客に出すのは今の値のままで、
-- 運営の一覧と詳細は、今の値と写しが違えば「承認後に変更あり」と出す。写しの許可書は、店が上げ直しても消さない。
ALTER TABLE stores ADD COLUMN approved_at TEXT;
ALTER TABLE stores ADD COLUMN approved_name TEXT;
ALTER TABLE stores ADD COLUMN approved_address TEXT;
ALTER TABLE stores ADD COLUMN approved_license_key TEXT;
ALTER TABLE stores ADD COLUMN approved_license_mime TEXT;

-- ---------- 審査の手がかり（運営-05） ----------
-- 許可書を上げた時刻（上げ直しに気づくため）と、運営のメモ・「連絡済み」の印（差し戻しの連絡をした店を、
-- 承認待ちの数から外すため。連絡のあとで許可書が上げ直されたら、また承認待ちに数える）。
ALTER TABLE stores ADD COLUMN license_uploaded_at TEXT;
ALTER TABLE stores ADD COLUMN admin_note TEXT;
ALTER TABLE stores ADD COLUMN contacted_at TEXT;

-- すでに承認済み・止められている店は、この migration を当てた時点の値を承認の写しにする
-- （それより前の変更は辿れない。承認の時刻は分からないので NULL のまま）。
-- 写しを作っておかないと、この店が許可書を上げ直したときに、審査で見た許可書が消える。
UPDATE stores
   SET approved_name = name,
       approved_address = address,
       approved_license_key = license_key,
       approved_license_mime = license_mime
 WHERE status IN ('approved', 'banned');
