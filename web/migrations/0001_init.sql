PRAGMA foreign_keys = ON;

CREATE TABLE accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('store', 'admin')),
  store_id TEXT,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE TABLE stores (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  -- 店の登録の時刻。同点・同距離のときの並びに使う（要件6の基準 6.4・要件4の基準 4.12）
  created_at TEXT NOT NULL DEFAULT '2026-09-21T00:00:00.000Z',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'banned')),
  address TEXT,
  lat REAL,
  lng REAL,
  url TEXT,
  genres TEXT NOT NULL DEFAULT '[]',
  menus TEXT NOT NULL DEFAULT '[]',
  budget_min INTEGER,
  budget_max INTEGER,
  license_key TEXT,
  license_mime TEXT,
  card_registered_at TEXT,
  stripe_customer_id TEXT,
  card_setup_session_id TEXT
);

CREATE TABLE coupons (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  name TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id)
);

CREATE TABLE offers (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  capacity INTEGER NOT NULL,
  initial_capacity INTEGER NOT NULL,
  party_max INTEGER NOT NULL,
  published_at TEXT NOT NULL,
  until_at TEXT NOT NULL,
  coupon_ids TEXT NOT NULL DEFAULT '[]',
  ended_at TEXT,
  end_reason TEXT,
  FOREIGN KEY (store_id) REFERENCES stores(id)
);

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  nickname TEXT,
  phone TEXT,
  genres TEXT NOT NULL DEFAULT '[]',
  budget_max INTEGER,
  token_hash TEXT UNIQUE,
  deleted_at TEXT
);

CREATE TABLE reservations (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  fetch_id TEXT NOT NULL,
  party INTEGER NOT NULL,
  code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL,
  status_at TEXT NOT NULL,
  holds_slot INTEGER NOT NULL DEFAULT 1,
  completed_after_expiry INTEGER NOT NULL DEFAULT 0,
  coupons_json TEXT NOT NULL DEFAULT '[]',
  FOREIGN KEY (offer_id) REFERENCES offers(id),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE push_subscriptions (
  customer_id TEXT PRIMARY KEY,
  subscription_json TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE fetch_logs (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  origin_lat REAL NOT NULL,
  origin_lng REAL NOT NULL,
  party INTEGER NOT NULL,
  genres TEXT NOT NULL,
  budget_max INTEGER,
  candidate_count INTEGER NOT NULL,
  returned_count INTEGER NOT NULL,
  ai_used INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  at TEXT NOT NULL
);

CREATE TABLE fetch_items (
  id TEXT PRIMARY KEY,
  fetch_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  rank INTEGER NOT NULL,
  score REAL NOT NULL,
  reason TEXT NOT NULL,
  FOREIGN KEY (fetch_id) REFERENCES fetch_logs(id),
  FOREIGN KEY (store_id) REFERENCES stores(id)
);

CREATE TABLE selections (
  id TEXT PRIMARY KEY,
  fetch_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  at TEXT NOT NULL,
  FOREIGN KEY (fetch_id) REFERENCES fetch_logs(id),
  FOREIGN KEY (store_id) REFERENCES stores(id)
);

CREATE TABLE reservation_events (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL,
  status TEXT NOT NULL,
  at TEXT NOT NULL,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id)
);

CREATE TABLE ai_calls (
  id TEXT PRIMARY KEY,
  fetch_id TEXT NOT NULL,
  cost_usd REAL,
  duration_ms INTEGER NOT NULL,
  succeeded INTEGER NOT NULL,
  validation_failed INTEGER NOT NULL DEFAULT 0,
  resolved_model TEXT,
  request_id TEXT,
  fallback_level INTEGER,
  at TEXT NOT NULL,
  FOREIGN KEY (fetch_id) REFERENCES fetch_logs(id)
);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  at TEXT NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE rate_counters (
  key TEXT NOT NULL,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

CREATE INDEX idx_sessions_account ON sessions(account_id);
CREATE INDEX idx_coupons_store ON coupons(store_id);
CREATE INDEX idx_offers_store ON offers(store_id);
CREATE INDEX idx_reservations_offer ON reservations(offer_id);
CREATE INDEX idx_reservations_customer ON reservations(customer_id);
CREATE INDEX idx_fetch_items_fetch ON fetch_items(fetch_id);
CREATE INDEX idx_ai_calls_fetch ON ai_calls(fetch_id);
