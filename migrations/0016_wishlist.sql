CREATE TABLE wishlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_key TEXT NOT NULL,
  user_id TEXT NOT NULL,
  model TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(scope_key, user_id, model)
);
CREATE INDEX wishlist_scope_model ON wishlist(scope_key, model, id);
