CREATE TABLE brackets (
 id TEXT PRIMARY KEY, title TEXT NOT NULL, owner_user_id TEXT NOT NULL,
 edit_hash TEXT NOT NULL, edit_expires INTEGER NOT NULL,
 players_json TEXT NOT NULL DEFAULT '[]', results_json TEXT NOT NULL DEFAULT '{}',
 version INTEGER NOT NULL DEFAULT 0, published INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX brackets_public ON brackets(published,updated_at);
