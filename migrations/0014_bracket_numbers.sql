ALTER TABLE brackets ADD COLUMN short_code TEXT;
ALTER TABLE brackets ADD COLUMN layout TEXT NOT NULL DEFAULT 'seeded';
UPDATE brackets SET short_code=lower(hex(randomblob(6)));
CREATE UNIQUE INDEX brackets_short ON brackets(short_code);
