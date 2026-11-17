ALTER TABLE monitor_state ADD COLUMN transport TEXT;
ALTER TABLE monitor_state ADD COLUMN browser_day TEXT;
ALTER TABLE monitor_state ADD COLUMN browser_seconds INTEGER NOT NULL DEFAULT 0;
