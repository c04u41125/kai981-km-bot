-- Durable manual requests and weekly refresh completion; no credentials.
ALTER TABLE g3_state ADD COLUMN refresh_requested INTEGER NOT NULL DEFAULT 0;
ALTER TABLE g3_state ADD COLUMN refresh_handled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE g3_state ADD COLUMN weekly_ready TEXT;
ALTER TABLE g3_outbox ADD COLUMN is_schedule INTEGER NOT NULL DEFAULT 0;
-- Previous successful Flex announcements remain deduplicated; error notices may be replaced.
UPDATE g3_outbox SET is_schedule=1 WHERE json_valid(messages_json) AND json_extract(messages_json,'$[0].type')='flex';
UPDATE g3_outbox SET status='cancelled' WHERE is_schedule=0 AND status='pending';
