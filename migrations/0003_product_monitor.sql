CREATE TABLE monitor_state (
  id TEXT PRIMARY KEY,
  initialized INTEGER NOT NULL DEFAULT 0,
  last_success INTEGER,
  last_error TEXT,
  lease_owner TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0
);
INSERT INTO monitor_state(id) VALUES ('funbox');
CREATE TABLE monitor_products (
  product_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  first_seen INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE monitor_subscriptions (
  target_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  actor_user_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE monitor_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  message TEXT NOT NULL,
  retry_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  first_attempt INTEGER,
  last_http_status INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(target_id,product_id)
);
CREATE INDEX monitor_outbox_pending ON monitor_outbox(status,id);
