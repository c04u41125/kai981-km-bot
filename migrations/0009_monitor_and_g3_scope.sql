-- Stop queued M.M notifications and request a fresh G3 import with Kaohsiung.
UPDATE monitor_outbox SET status='cancelled' WHERE product_id LIKE 'mm:%' AND status='pending';
UPDATE g3_state SET last_success=NULL, last_attempt=0 WHERE id=1;
