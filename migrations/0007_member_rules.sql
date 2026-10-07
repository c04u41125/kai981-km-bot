-- 成員版規章；原管理層規定保留為個別知識，不列入「隊規」。
UPDATE knowledge SET id='internal-brand-event' WHERE id='rule-brand-event';
UPDATE knowledge SET id='internal-management' WHERE id='rule-management';
UPDATE knowledge SET id='rule-04' WHERE id='rule-join';

INSERT INTO knowledge(id,title,answer,aliases_json,source) VALUES
('rule-01','第1條　隊服穿著','成員參與對外賽事或其他戰鬥陀螺相關活動時，應儘量穿著迴眾隊服，以維持戰隊識別與整體形象。','["隊服穿著","穿隊服","隊服"]','迴眾 KAI 9.81 戰隊規章｜第1條 隊服穿著'),
('rule-02','第2條　零件使用規範','成員於任何場合均不得使用違改零件。','["零件使用規範","違改零件","零件規範"]','迴眾 KAI 9.81 戰隊規章｜第2條 零件使用規範'),
('rule-03','第3條　管理員組成','迴眾管理員共四名：漢克、子評、寶哥、佩嘉。','["管理員組成","管理員","管理員名單"]','迴眾 KAI 9.81 戰隊規章｜第3條 管理員組成'),
('rule-04','第4條　新成員加入','新成員之加入，應由一名管理員提出，並經另一名管理員同意後，始得完成加入程序。','["新成員加入","如何加入","加入迴眾","新成員","新人加入","入隊"]','迴眾 KAI 9.81 戰隊規章｜第4條 新成員加入'),
('rule-05','第5條　上位圖製作','成員參加官方賽事，或參加參賽人數達128人以上之私人賽事並取得上位成績者，迴眾將製作專屬上位圖。','["上位圖製作","上位圖","上位製圖"]','迴眾 KAI 9.81 戰隊規章｜第5條 上位圖製作'),
('rule-06','第6條　隊服及周邊管理','隊服、貼紙及其他迴眾品牌周邊，未經管理員同意，不得私自對外轉讓、販售、提供或以其他方式流出。','["隊服及周邊管理","周邊管理","周邊","貼紙","隊服轉讓"]','迴眾 KAI 9.81 戰隊規章｜第6條 隊服及周邊管理')
ON CONFLICT(id) DO UPDATE SET title=excluded.title,answer=excluded.answer,aliases_json=excluded.aliases_json,source=excluded.source,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');

-- 上位製圖已有成員版專條，避免單獨查詢時同時回覆舊表決說明。
UPDATE knowledge SET aliases_json='["管理事項","入群規範","衣服製作","成員調節","申辦比賽","對外對接","公關處理","管理層過半","表決","管理規範"]' WHERE id='internal-management';
