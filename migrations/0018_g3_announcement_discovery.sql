CREATE TABLE g3_sources (
 year INTEGER NOT NULL, first INTEGER NOT NULL CHECK(first IN (1,3,5,7,9,11)),
 name TEXT NOT NULL CHECK(name IN ('Funbox','B4合作據點','夾子園')),
 sheet_id TEXT NOT NULL, post_url TEXT,
 PRIMARY KEY(year,first,name)
);
ALTER TABLE g3_state ADD COLUMN discovery_attempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE g3_state ADD COLUMN discovery_success INTEGER;
ALTER TABLE g3_state ADD COLUMN discovery_error TEXT;
ALTER TABLE g3_state ADD COLUMN discovery_week TEXT;
ALTER TABLE g3_state ADD COLUMN discovery_day TEXT;
ALTER TABLE g3_state ADD COLUMN discovery_runs INTEGER NOT NULL DEFAULT 0;
ALTER TABLE g3_state ADD COLUMN discovery_post TEXT;
ALTER TABLE g3_state ADD COLUMN discovery_period TEXT;
INSERT INTO g3_sources(year,first,name,sheet_id) VALUES(2026,9,'Funbox','16J7KBQ-B_aCf-0Hc9fhHBkT7e6XfhA2bFJehqGnmkwY');
INSERT INTO g3_sources(year,first,name,sheet_id) VALUES(2026,9,'B4合作據點','1MSSZJZKCqDWmPcfIuI4iNLNXU0nyD2VIAU0gr0iBzv8');
INSERT INTO g3_sources(year,first,name,sheet_id) VALUES(2026,9,'夾子園','1Y3jb2TJx8HHCBEHhXM8ugX3IUpSDD_hY-BZ6f3HVloo');
INSERT INTO g3_sources(year,first,name,sheet_id) VALUES(2026,11,'Funbox','1T4as64A4LiAUmTD4pRP5bz00ifJdt3isGCL9jcQgNCk');
INSERT INTO g3_sources(year,first,name,sheet_id) VALUES(2026,11,'B4合作據點','1ec0T7LyN3DlfBhrsSJTRXqWEA8Q1fTmqIfMtSAcoxpo');
INSERT INTO g3_sources(year,first,name,sheet_id) VALUES(2026,11,'夾子園','1Mdkmg4aIFuy6MBOR8J3kr7Iagmptp2CKH506bmdM6dM');
