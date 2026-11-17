ALTER TABLE monitor_state ADD COLUMN last_local_success INTEGER;
ALTER TABLE monitor_state ADD COLUMN last_local_observed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE monitor_state ADD COLUMN last_cloud_error TEXT;
