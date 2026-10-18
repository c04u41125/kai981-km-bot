ALTER TABLE webhook_events ADD COLUMN messages_json TEXT;
ALTER TABLE g3_outbox ADD COLUMN messages_json TEXT;
