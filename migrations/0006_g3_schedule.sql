CREATE TABLE g3_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  period_start TEXT, period_end TEXT, last_success INTEGER,
  last_attempt INTEGER NOT NULL DEFAULT 0, last_error TEXT,
  refresh_day TEXT, lease_owner TEXT, lease_until INTEGER NOT NULL DEFAULT 0
);
INSERT INTO g3_state(id) VALUES(1);
CREATE TABLE g3_events (
  id TEXT PRIMARY KEY, source_id TEXT NOT NULL, source_url TEXT NOT NULL,
  region TEXT NOT NULL, venue TEXT NOT NULL, address TEXT NOT NULL,
  event_date TEXT NOT NULL, event_time TEXT NOT NULL,
  phone TEXT NOT NULL, capacity TEXT NOT NULL, registration TEXT NOT NULL,
  division TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX g3_events_week ON g3_events(active,event_date);
CREATE TABLE g3_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, target_id TEXT NOT NULL,
  week_start TEXT NOT NULL, part INTEGER NOT NULL, message TEXT NOT NULL,
  retry_key TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','sent','failed','cancelled')),
  first_attempt INTEGER, last_http_status INTEGER,
  UNIQUE(target_id,week_start,part)
);
CREATE INDEX g3_pending ON g3_outbox(status,id);
