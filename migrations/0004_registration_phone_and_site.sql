ALTER TABLE registrations ADD COLUMN phone TEXT NOT NULL DEFAULT '';
ALTER TABLE monitor_products ADD COLUMN price TEXT NOT NULL DEFAULT '未提供';
INSERT INTO knowledge(id,title,answer,aliases_json,source) VALUES
('official-site','官方網站','迴眾 KM Bot 官方入口：https://c04u41125.github.io/kai981-km-bot/','["官網","官方網站","官方入口"]','本專案公開網站｜GitHub Pages');
