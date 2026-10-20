-- Reimport all counties and cities; keep historical rows.
UPDATE g3_state SET last_success=NULL,last_attempt=0 WHERE id=1;
