-- 席アキ（デモ）: 店・客・オファー・配信。フェーズ2向けの項目（出どころ・作成者・教師データ）は持たない
CREATE TABLE stores (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL,          -- 店ごとの秘密の鍵の SHA-256（平文は保存しない）
  name TEXT NOT NULL,
  genre TEXT NOT NULL,
  avg_price INTEGER NOT NULL,
  allergens TEXT NOT NULL,         -- JSON 配列
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  presets TEXT NOT NULL            -- JSON 配列（3つ）
);
CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  spot TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  genres TEXT NOT NULL,            -- JSON 配列
  budget_max INTEGER,
  allergies TEXT NOT NULL,         -- JSON 配列
  prefs_source TEXT NOT NULL,      -- llm | rule | seed
  seeded INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE offers (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  seats INTEGER NOT NULL,
  perk TEXT NOT NULL,
  message TEXT NOT NULL,
  message_source TEXT NOT NULL,    -- llm | template
  llm_cost_usd REAL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL,            -- active | stopped | capped | exhausted | expired
  cap INTEGER NOT NULL,
  candidate_ids TEXT NOT NULL,     -- JSON 配列（決定論で並べた配信順）
  waves TEXT NOT NULL,             -- JSON 配列 [{index,size,sentAt}]
  last_check_at INTEGER NOT NULL,  -- 楽観ロック兼「反応を数える窓」の起点
  stop_reason TEXT
);
CREATE TABLE deliveries (
  offer_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  wave INTEGER NOT NULL,
  distance_m INTEGER NOT NULL,
  sent_at INTEGER NOT NULL,
  opened_at INTEGER,
  going_at INTEGER,
  redeemed_at INTEGER,
  PRIMARY KEY (offer_id, customer_id)
);
CREATE INDEX deliveries_customer ON deliveries (customer_id);
