PRAGMA foreign_keys = ON;

CREATE TABLE knowledge (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  answer TEXT NOT NULL,
  aliases_json TEXT NOT NULL CHECK(json_valid(aliases_json)),
  source TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE activities (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  location TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK(capacity >= 1 AND capacity <= 10000),
  status TEXT NOT NULL CHECK(status IN ('open','closed')),
  source TEXT NOT NULL,
  created_event_id TEXT UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_id TEXT NOT NULL REFERENCES activities(id),
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('confirmed','waitlisted')),
  event_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(activity_id, user_id)
);
CREATE INDEX registrations_status ON registrations(activity_id,status);
CREATE TABLE pending_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  question TEXT NOT NULL,
  source_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE conversations (
  context_key TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('choose','name')),
  activity_id TEXT REFERENCES activities(id),
  choices_json TEXT NOT NULL DEFAULT '[]',
  expires_at INTEGER NOT NULL
);
CREATE TABLE webhook_events (
  event_id TEXT PRIMARY KEY,
  reply_text TEXT NOT NULL,
  reply_status TEXT NOT NULL DEFAULT 'pending' CHECK(reply_status IN ('pending','sending','sent','failed')),
  lease_owner TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_http_status INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE admin_audit (
  event_id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
