INSERT INTO monitor_state(id) VALUES ('mmtoy');
CREATE TABLE mm_products (
  product_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  price TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('restocking','available','unknown')),
  cycle INTEGER NOT NULL DEFAULT 0,
  scan_id TEXT NOT NULL
);
