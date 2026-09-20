-- v2 の速成版（2026-09-20）。v1 のテーブル（stores/customers/offers/deliveries）はそのまま残し、
-- v2 は s_ で始まる別のテーブルを使う。
CREATE TABLE IF NOT EXISTS s_stores (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  genre TEXT NOT NULL,
  price_avg INTEGER NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  menus TEXT NOT NULL DEFAULT '[]',      -- [{name, price, allergens:[]}]
  approved INTEGER NOT NULL DEFAULT 0,   -- 0=承認待ち 1=承認済み
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS s_offers (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  title TEXT NOT NULL,                   -- サービス内容
  party_size INTEGER NOT NULL,           -- 1組の人数（何名）
  qty INTEGER NOT NULL,                  -- 何個（組数）
  remaining INTEGER NOT NULL,
  coupon_note TEXT NOT NULL DEFAULT '',  -- 食べログなどのクーポン（店が手で打つ）
  start_min INTEGER NOT NULL,            -- 受付時間の開始（0:00 からの分）
  end_min INTEGER NOT NULL,              -- 受付時間の終了
  active INTEGER NOT NULL DEFAULT 1,     -- 0=店が止めている
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_s_offers_store ON s_offers(store_id);

CREATE TABLE IF NOT EXISTS s_customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  prefs TEXT NOT NULL,                   -- {genres:[], budgetMax:null|int, allergies:[], summary:""}
  prefs_source TEXT NOT NULL,            -- llm | rule
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS s_claims (
  code TEXT PRIMARY KEY,                 -- 8桁
  customer_id TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  party INTEGER NOT NULL,
  claimed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_s_claims_customer ON s_claims(customer_id);
CREATE INDEX IF NOT EXISTS idx_s_claims_store ON s_claims(store_id);

-- 取得の記録（誰に・何位で見せて・選ばれたか）
CREATE TABLE IF NOT EXISTS s_requests (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  party INTEGER NOT NULL,
  candidates INTEGER NOT NULL,
  returned INTEGER NOT NULL,
  ai_used INTEGER NOT NULL,              -- 1=AI が選んだ 0=点数順に倒れた
  cost_usd REAL,
  items TEXT NOT NULL,                   -- [{storeId, rank, score}]
  created_at INTEGER NOT NULL
);
