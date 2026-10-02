import { monitorCommand, monitorStatus, scheduledMonitor } from './monitor.js';
import { scheduledG3, g3Status, g3Weekend } from './g3.js';
import { marketReply } from './market.js';
const COMMAND_HELP = String.raw`可用指令：
1. 建立賽事／活動（管理員）：建立賽事 YYYY-MM-DD 賽事名稱
2. 報名賽事／活動：我要報名，接著姓名 王小明 電話 0912345678
3. 查詢賽事／活動：活動 或 查詢活動
4. 查詢隊規：隊規
5. 查詢官網：官網
6. 查詢指令：指令
7. 查詢行情：型號行情（例如 UX-01行情）
G3 官方賽程：本週G3、G3狀態`;
const UNKNOWN = '目前沒有已確認資料';
const HELP = COMMAND_HELP;
const normalize = value => value.normalize('NFKC').toLowerCase().replace(/[\s？?。！!]/g, '');
const stmt = (db, sql, ...args) => db.prepare(sql).bind(...args);
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const validString = (s, max = 200) => typeof s === 'string' && s.trim().length > 0 && s.length <= max && !/[\u0000-\u0008\u000B-\u001F]/.test(s);
const keyPattern = /^[a-z0-9][a-z0-9_-]{0,39}$/;

function replyMessages(text) {
  // LINE 每次最多 5 則文字訊息，每則最多 5000 字；保留完整來源與活動清單。
  const messages = [];
  let remaining = text.length > 23000 ? `${text.slice(0, 23000)}\n（資料過多，請縮小查詢主題。）` : text;
  while (remaining && messages.length < 5) {
    let end = Math.min(4700, remaining.length);
    if (end < remaining.length && /[\uD800-\uDBFF]/.test(remaining[end - 1])) end--;
    messages.push({ type: 'text', text: remaining.slice(0, end) });
    remaining = remaining.slice(end);
  }
  return messages;
}

function groupMentioned(event) {
  if (event.source?.type !== 'group' && event.source?.type !== 'room') return true;
  const mentions = event.message?.mention?.mentionees;
  if (!Array.isArray(mentions)) return false;
  // LINE 的全體提及優先忽略；即使同時 @Bot，也不執行指令、記錄或回覆。
  if (mentions.some(m => m?.type === 'all')) return false;
  return mentions.some(m => m?.isSelf === true);
}

function removeBotMention(event) {
  const text = event.message.text;
  const mentionees = (event.message.mention?.mentionees || [])
    .filter(m => m.isSelf === true && Number.isInteger(m.index) && Number.isInteger(m.length) && m.index >= 0 && m.length > 0)
    .sort((a, b) => b.index - a.index);
  let result = text;
  for (const m of mentionees) result = result.slice(0, m.index) + result.slice(m.index + m.length);
  return result.trim();
}

async function verifySignature(raw, signature, secret) {
  if (!secret || !signature || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const bytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  return crypto.subtle.verify('HMAC', key, bytes, raw);
}

async function readBody(request, limit) {
  if (Number(request.headers.get('content-length')) > limit) throw new Error('BODY_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new Error('BODY_TOO_LARGE'); }
    chunks.push(value);
  }
  const raw = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { raw.set(chunk, offset); offset += chunk.length; }
  return raw;
}

async function knowledge(db, question) {
  const rows = (await db.prepare('SELECT id,title,answer,aliases_json,source FROM knowledge ORDER BY id').all()).results;
  const q = normalize(question);
  // 精確別名比對，避免將「不用三票嗎」等否定問句誤判為已確認答案。
  const matches = q === '隊規' ? rows.filter(r => r.id.startsWith('rule-')) : rows.filter(r =>
    [r.title, ...JSON.parse(r.aliases_json)].some(alias => normalize(alias) === q));
  if (!matches.length) return { confirmed: false, text: UNKNOWN, sources: [] };
  return { confirmed: true, text: matches.map(r => `${r.title}\n${r.answer}\n來源：${r.source}`).join('\n\n'), sources: matches.map(r => r.source) };
}

async function activities(db, onlyOpen = false) {
  return (await db.prepare(`SELECT a.id,a.title,a.starts_at,a.location,a.capacity,a.status,a.source,
    (SELECT COUNT(*) FROM registrations r WHERE r.activity_id=a.id AND r.status='confirmed') AS confirmed,
    (SELECT COUNT(*) FROM registrations r WHERE r.activity_id=a.id AND r.status='waitlisted') AS waitlisted
    FROM activities a ${onlyOpen ? "WHERE a.status='open' AND julianday(a.starts_at)>julianday('now')" : ''}
    ORDER BY starts_at,id LIMIT 30`).all()).results;
}
function activityText(a) {
  return `${a.title} [${a.id}]\n時間：${a.starts_at}\n地點：${a.location}\n名額：${a.capacity}｜正取 ${a.confirmed}｜候補 ${a.waitlisted}\n報名狀態：${a.status === 'open' ? '開放' : '關閉'}${Date.parse(a.starts_at) <= Date.now() ? '（已達活動時間，不接受新報名）' : ''}\n來源：${a.source}`;
}

// 每個事件的所有資料異動與回覆內容在同一 D1 batch transaction 提交。
// 每個異動都檢查事件尚未提交，併發重送只會執行一次。
function planFor(db, eventId) {
  const statements = [];
  const guard = 'NOT EXISTS (SELECT 1 FROM webhook_events WHERE event_id=?)';
  return {
    guard,
    add(sql, ...args) { statements.push(stmt(db, sql, ...args)); },
    async commit(text, responseSql, responseArgs = []) {
      const expression = responseSql || '?';
      const args = responseSql ? responseArgs : [text];
      statements.push(stmt(db, `INSERT INTO webhook_events(event_id,reply_text)
        SELECT ?,${expression} WHERE ${guard}`, eventId, ...args, eventId));
      statements.push(stmt(db, 'SELECT * FROM webhook_events WHERE event_id=?', eventId));
      const results = await db.batch(statements);
      return results.at(-1).results[0];
    }
  };
}

function setSession(p, eventId, context, phase, activityId, choices = []) {
  p.add(`INSERT INTO conversations(context_key,version,phase,activity_id,choices_json,expires_at)
    SELECT ?,?,?,?,?,unixepoch()+900 WHERE ${p.guard}
    ON CONFLICT(context_key) DO UPDATE SET version=excluded.version,phase=excluded.phase,
    activity_id=excluded.activity_id,choices_json=excluded.choices_json,expires_at=excluded.expires_at`,
  context, eventId, phase, activityId, JSON.stringify(choices), eventId);
}

async function adminPlan(db, env, event, text, p) {
  const user = event.source.userId;
  const admins = (env.ADMIN_LINE_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!['user','group','room'].includes(event.source.type) || !user || !admins.includes(user)) return p.commit('管理操作已拒絕：需要管理員白名單。');
  if (text === '/admin pending') {
    const rows = (await db.prepare("SELECT id,question FROM pending_questions WHERE status='pending' ORDER BY id DESC LIMIT 10").all()).results;
    return p.commit(rows.length ? rows.map(r => `#${r.id} ${r.question.slice(0, 300)}`).join('\n') : '目前沒有待補問題。');
  }
  const match = text.match(/^\/admin (knowledge|activity|close|delete|resolve)\s+([\s\S]+)$/);
  if (!match) return p.commit('管理指令：/admin pending、/admin knowledge {JSON}、/admin activity {JSON}、/admin close 活動ID（或 delete）、/admin resolve 問題ID。格式請見 README。');
  const [, action, payload] = match;
  let data;
  try { if (action === 'knowledge' || action === 'activity') data = JSON.parse(payload); }
  catch { return p.commit('JSON 格式錯誤，未修改任何資料。'); }
  if (action === 'knowledge') {
    if (!data || !validString(data.id, 40) || !keyPattern.test(data.id) || !validString(data.title, 80) || !validString(data.answer, 1200) || !validString(data.source, 200) || !Array.isArray(data.aliases) || data.aliases.length < 1 || data.aliases.length > 30 || data.aliases.some(s => !validString(s, 80))) return p.commit('知識欄位不合法：需要 id、title、answer、source、aliases（1–30 個別名）。');
    p.add(`INSERT INTO knowledge(id,title,answer,source,aliases_json) SELECT ?,?,?,?,? WHERE ${p.guard}
      ON CONFLICT(id) DO UPDATE SET title=excluded.title,answer=excluded.answer,source=excluded.source,
      aliases_json=excluded.aliases_json,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    data.id, data.title.trim(), data.answer.trim(), data.source.trim(), JSON.stringify(data.aliases), event.webhookEventId);
  } else if (action === 'activity') {
    if (!data || !validString(data.id, 40) || !keyPattern.test(data.id) || !validString(data.title, 80) || !validString(data.location, 200) || !validString(data.source, 200) || !Number.isInteger(data.capacity) || data.capacity < 1 || data.capacity > 10000 || !['open','closed'].includes(data.status) || !validString(data.starts_at, 40) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(Z|[+-]\d{2}:\d{2})$/.test(data.starts_at) || !Number.isFinite(Date.parse(data.starts_at)) || Date.parse(data.starts_at) <= Date.now()) return p.commit('活動欄位不合法：需未來且含時區的 starts_at、id、title、location、capacity（1–10000）、status（open/closed）、source。');
    if (await stmt(db, 'SELECT id FROM activities WHERE id=?', data.id).first()) return p.commit('活動 ID 已存在。第一階段只允許新增與關閉活動；時間、名額異動請由資料庫維護者另行處理。');
    p.add(`INSERT INTO activities(id,title,starts_at,location,capacity,status,source,created_event_id)
      SELECT ?,?,?,?,?,?,?,? WHERE ${p.guard} ON CONFLICT(id) DO NOTHING`,
    data.id, data.title.trim(), new Date(data.starts_at).toISOString(), data.location.trim(), data.capacity, data.status, data.source.trim(), event.webhookEventId, event.webhookEventId);
  } else if (action === 'close' || action === 'delete') {
    if (!keyPattern.test(payload) || !await stmt(db, 'SELECT id FROM activities WHERE id=?', payload).first()) return p.commit('找不到該活動，未修改資料。');
    p.add(`UPDATE activities SET status='closed' WHERE id=? AND ${p.guard}`, payload, event.webhookEventId);
  } else {
    if (!/^\d+$/.test(payload) || !await stmt(db, 'SELECT id FROM pending_questions WHERE id=?', Number(payload)).first()) return p.commit('找不到該問題，未修改資料。');
    p.add(`UPDATE pending_questions SET status='resolved' WHERE id=? AND ${p.guard}`, Number(payload), event.webhookEventId);
  }
  p.add(`INSERT INTO admin_audit(event_id,actor_user_id,action) SELECT ?,?,? WHERE ${p.guard}`, event.webhookEventId, user, action, event.webhookEventId);
  if (action === 'activity') return p.commit(null, `(SELECT CASE WHEN created_event_id=? THEN '活動已建立。' ELSE '活動 ID 已存在，未覆寫資料。' END FROM activities WHERE id=?)`, [event.webhookEventId, data.id]);
  return p.commit('管理操作完成。');
}

async function quickActivityPlan(db, env, event, text, p) {
  const admins = (env.ADMIN_LINE_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!admins.includes(event.source.userId)) return p.commit('建立活動已拒絕：需要管理員白名單。');
  const match = text.match(/^建立(?:賽事|活動)\s+(\d{4}-\d{2}-\d{2})\s+(.+)$/);
  if (!match) return p.commit('格式：建立賽事 YYYY-MM-DD 賽事名稱');
  const [, date, title] = match;
  const timestamp = Date.parse(`${date}T00:00:00+08:00`);
  if (!validString(title, 80) || !Number.isFinite(timestamp) || timestamp <= Date.now()) return p.commit('日期需為未來日期，名稱需為 1–80 字。');
  const id = `event-${date}-${event.webhookEventId.slice(-8).toLowerCase()}`;
  p.add(`INSERT INTO activities(id,title,starts_at,location,capacity,status,source,created_event_id)
    SELECT ?,?,?,?,?,?,?,? WHERE ${p.guard} ON CONFLICT(id) DO NOTHING`, id, title.trim(), new Date(timestamp).toISOString(), '未提供', 10000, 'open', 'LINE 管理員建立', event.webhookEventId, event.webhookEventId);
  p.add(`INSERT INTO admin_audit(event_id,actor_user_id,action) SELECT ?,?,? WHERE ${p.guard}`, event.webhookEventId, event.source.userId, 'activity_quick_create', event.webhookEventId);
  return p.commit(`活動已建立：${title.trim()}（${date}）。目前地點為「未提供」、名額為 10000；如需完整地點／名額，請使用 /admin activity JSON。`);
}

async function buildReply(db, env, event) {
  const eventId = event.webhookEventId;
  const existing = await stmt(db, 'SELECT * FROM webhook_events WHERE event_id=?', eventId).first();
  if (existing) return existing;
  const p = planFor(db, eventId);
  const text = removeBotMention(event);
  if (!text) return p.commit('請在 @Bot 後輸入問題或指令。');
  const market = await marketReply(text);
  if (market !== null) return p.commit(market);
  const source = event.source;
  const user = source.userId;
  const context = user ? JSON.stringify([source.type, source.groupId || source.roomId || user, user]) : null;
  if (['本週G3','本週g3','G3','g3'].includes(text)) return p.commit((await g3Weekend(db)).text);
  if (['G3狀態','g3狀態'].includes(text)) {
    const s = await g3Status(db);
    return p.commit(`G3 賽程：${s.period_start || '未讀取'}～${s.period_end || '未讀取'}\n已記錄 ${s.events} 場\n最後更新：${s.last_success ? new Date(s.last_success * 1000).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' }) : '尚未完成'}\n來源狀態：${s.last_error || '正常'}\n每週一台灣時間 09:00 推播至已啟用 /monitor on 的群組。`);
  }
  if (text.startsWith('/monitor')) return monitorCommand(db, env, event, text, p);
  if (text.startsWith('/admin')) return adminPlan(db, env, event, text, p);
  if (text === '指令' || text === '說明' || text === 'help' || text === '幫助') return p.commit(COMMAND_HELP);
  if (/^建立(?:賽事|活動)/.test(text)) return quickActivityPlan(db, env, event, text, p);
  if (text === '取消') {
    if (context) p.add(`DELETE FROM conversations WHERE context_key=? AND ${p.guard}`, context, eventId);
    return p.commit('已結束報名對話；已完成的報名不會被取消。');
  }
  if (text === '活動' || text === '查詢活動') {
    const rows = await activities(db);
    return p.commit(rows.length ? rows.map(activityText).join('\n\n') : `${UNKNOWN}：尚未建立活動。`);
  }
  if (text === '我的報名') {
    if (!user) return p.commit('無法取得 LINE 使用者識別，請改用 Bot 私訊查詢。');
    const rows = (await stmt(db, `SELECT a.title,r.status FROM registrations r JOIN activities a ON a.id=r.activity_id WHERE r.user_id=? ORDER BY r.id DESC LIMIT 30`, user).all()).results;
    return p.commit(rows.length ? rows.map(r => `${r.title}：${r.status === 'confirmed' ? '正取' : '候補'}`).join('\n') : '目前沒有你的報名紀錄。');
  }
  if (text === '我要報名') {
    if (!user) return p.commit('無法取得 LINE 使用者識別，請改用 Bot 私訊報名。');
    const rows = await activities(db, true);
    if (!rows.length) return p.commit(`${UNKNOWN}：目前沒有可報名的活動。`);
    if (rows.length === 1) {
      setSession(p, eventId, context, 'name', rows[0].id);
      return p.commit(`${activityText(rows[0])}\n\n請在 15 分鐘內輸入「姓名 王小明 電話 0912345678」。${source.type !== 'user' ? '\n注意：群組內的姓名與電話會被群組成員看到，也可以改用私訊重新輸入「我要報名」。' : ''}`);
    }
    setSession(p, eventId, context, 'choose', null, rows.map(r => r.id));
    return p.commit(`請在 15 分鐘內輸入「選擇 活動ID」：\n\n${rows.map(activityText).join('\n\n')}`);
  }
  const session = context ? await stmt(db, 'SELECT * FROM conversations WHERE context_key=? AND expires_at>unixepoch()', context).first() : null;
  if (text.startsWith('選擇 ')) {
    const id = text.slice(3).trim();
    if (!session || session.phase !== 'choose') return p.commit('請先輸入「我要報名」。');
    if (!JSON.parse(session.choices_json).includes(id)) return p.commit('請輸入清單內的活動 ID，例如「選擇 training-01」。');
    const row = (await activities(db, true)).find(r => r.id === id);
    if (!row) return p.commit('該活動目前無法報名，請重新輸入「我要報名」。');
    setSession(p, eventId, context, 'name', id);
    return p.commit(`已選擇 ${row.title}。請輸入「姓名 王小明 電話 0912345678」。群組內的姓名與電話會被群組成員看到。`);
  }
  if (text.startsWith('姓名 ')) {
    if (!session || session.phase !== 'name') return p.commit('報名對話不存在或已逾時，請輸入「我要報名」。');
    const details = text.match(/^姓名\s+(.+?)\s+電話\s+([0-9+()\- ]{6,30})$/);
    const name = details?.[1]?.trim();
    const phone = details?.[2]?.replace(/[ ()-]/g, '');
    if (!validString(name, 50) || !phone || !/^[0-9+]{6,20}$/.test(phone)) return p.commit('格式：姓名 王小明 電話 0912345678');
    // 正取計數與 INSERT 在單一 SQL 內，D1 序列化寫入避免最後一席超賣。
    p.add(`INSERT INTO registrations(activity_id,user_id,name,phone,status,event_id)
      SELECT a.id,?,?,?,CASE WHEN (SELECT COUNT(*) FROM registrations r WHERE r.activity_id=a.id AND r.status='confirmed')<a.capacity THEN 'confirmed' ELSE 'waitlisted' END,?
      FROM activities a WHERE a.id=? AND a.status='open' AND julianday(a.starts_at)>julianday('now')
      AND EXISTS(SELECT 1 FROM conversations WHERE context_key=? AND version=? AND expires_at>unixepoch())
      AND ${p.guard} ON CONFLICT(activity_id,user_id) DO NOTHING`, user, name, phone, eventId, session.activity_id, context, session.version, eventId);
    p.add(`DELETE FROM conversations WHERE context_key=? AND version=? AND ${p.guard}`, context, session.version, eventId);
    return p.commit(null, `COALESCE((SELECT a.title || '：' || CASE r.status WHEN 'confirmed' THEN '正取' ELSE '候補' END ||
      CASE WHEN r.event_id=? THEN '，報名完成。' ELSE '，你已報名，未重複新增。' END || char(10) || '來源：D1 活動與報名紀錄'
      FROM registrations r JOIN activities a ON a.id=r.activity_id WHERE r.activity_id=? AND r.user_id=?),
      '未完成報名：活動已關閉、已開始或對話已更新。請重新輸入「我要報名」。')`, [eventId, session.activity_id, user]);
  }
  const answer = await knowledge(db, text);
  if (!answer.confirmed) {
    if (/^(\/|我要|建立|新增|刪除|關閉|取消|選擇|姓名|查詢|活動|隊規|品牌|管理)/.test(text)) {
      return p.commit(`目前沒有已確認資料。\n\n${HELP}`);
    }
    p.add(`INSERT INTO pending_questions(event_id,question,source_type) SELECT ?,?,? WHERE ${p.guard}`, eventId, text, source.type, eventId);
      return p.commit(`${UNKNOWN}，此問題已記入待補問題清單。\n\n${COMMAND_HELP}${session ? '\n報名中請使用「選擇 活動ID」或「姓名 王小明 電話 0912345678」。' : ''}`);
  }
  return p.commit(answer.text);
}

async function deliverReply(db, env, event, row) {
  if (row.reply_status === 'sent' || row.reply_status === 'failed') return;
  const owner = crypto.randomUUID();
  const claimed = await stmt(db, `UPDATE webhook_events SET reply_status='sending',lease_owner=?,lease_until=unixepoch()+30
    WHERE event_id=? AND (reply_status='pending' OR (reply_status='sending' AND lease_until<unixepoch())) RETURNING event_id`, owner, event.webhookEventId).first();
  if (!claimed) throw new Error('REPLY_BUSY');
  let response;
  try {
    response = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST', headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ replyToken: event.replyToken, messages: replyMessages(row.reply_text) }),
      signal: AbortSignal.timeout(10000)
    });
  } catch {
    await stmt(db, "UPDATE webhook_events SET reply_status='pending',lease_until=0 WHERE event_id=? AND lease_owner=?", event.webhookEventId, owner).run();
    throw new Error('LINE_NETWORK');
  }
  // 400 常為 replyToken 過期或已使用；不無限重試。5xx/429/401/403 可在修復後重送。
  const status = response.ok ? 'sent' : response.status === 400 ? 'failed' : 'pending';
  await stmt(db, 'UPDATE webhook_events SET reply_status=?,last_http_status=?,lease_until=0 WHERE event_id=? AND lease_owner=?', status, response.status, event.webhookEventId, owner).run();
  if (!response.ok) console.warn(JSON.stringify({ code: 'LINE_REPLY_ERROR', eventId: event.webhookEventId, status: response.status }));
  if (status === 'pending') throw new Error('LINE_RETRY');
}

function eligible(event) {
  if (event?.type !== 'message' || event.message?.type !== 'text') return false;
  if (!validString(event.message.text, 5000) || !validString(event.webhookEventId, 200) || !validString(event.replyToken, 200)) return false;
  const s = event.source;
  if (!s || !['user','group','room'].includes(s.type)) return false;
  if (s.type === 'user' && !validString(s.userId, 100)) return false;
  if (s.type === 'group' && !validString(s.groupId, 100)) return false;
  if (s.type === 'room' && !validString(s.roomId, 100)) return false;
  if (s.userId !== undefined && !validString(s.userId, 100)) return false;
  // 群組／多人聊天室平常聊天不進入查詢、待補問題或回覆流程；只有 LINE 明確標記 Bot 被提及才處理。
  if (!groupMentioned(event)) return false;
  return true;
}

async function webhook(request, env, db) {
  if (!env.LINE_CHANNEL_SECRET) return json({ error: 'Webhook 尚未設定' }, 503);
  const raw = await readBody(request, 1024 * 1024);
  // 必須驗證原始 bytes，驗證之前絕不 JSON.parse、解碼或重組 body。
  if (!await verifySignature(raw, request.headers.get('x-line-signature'), env.LINE_CHANNEL_SECRET)) return json({ error: 'Invalid signature' }, 401);
  let payload;
  try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { return json({ error: 'Invalid JSON' }, 400); }
  if (!payload || !Array.isArray(payload.events) || payload.events.length > 100) return json({ error: 'Invalid events' }, 400);
  // LINE Console Verify 使用 events: []，不需要呼叫 Reply API。
  if (!payload.events.length) return json({ ok: true });
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) return json({ error: 'Reply API 尚未設定' }, 503);
  let failed = false;
  for (const event of payload.events) {
    if (!eligible(event)) continue;
    try { await deliverReply(db, env, event, await buildReply(db, env, event)); }
    catch { failed = true; console.error(JSON.stringify({ code: 'EVENT_RETRY_REQUIRED', eventId: event.webhookEventId })); }
  }
  return json({ ok: !failed }, failed ? 503 : 200);
}

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(scheduledMonitor(env));
    if (new Date(controller.scheduledTime).getUTCMinutes() % 5 === 0) ctx.waitUntil(scheduledG3(env, controller.scheduledTime));
  },
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    let response;
    try {
      // 從 primary 開始讀取，避免已開啟 D1 read replication 時讀到舊狀態。
      const db = env.DB.withSession('first-primary');
      if (url.pathname === '/webhook') {
        response = request.method === 'POST' ? await webhook(request, env, db) : json({ error: 'Method not allowed' }, 405);
      } else if (url.pathname.startsWith('/api/')) {
        if (request.method !== 'GET') response = json({ error: 'Read-only API' }, 405);
        else if (url.pathname === '/api/knowledge') {
          const q = url.searchParams.get('q') || '';
          response = validString(q, 200) ? json(await knowledge(db, q)) : json({ error: '請輸入 1–200 字問題' }, 400);
        } else if (url.pathname === '/api/activities') response = json({ activities: await activities(db) });
        else if (url.pathname === '/api/monitor') response = json(await monitorStatus(db));
        else if (url.pathname === '/api/g3') response = json(await g3Status(db));
        else response = json({ error: 'Not found' }, 404);
      } else response = json({ error: 'Not found' }, 404);
    } catch (error) {
      response = json({ error: error.message === 'BODY_TOO_LARGE' ? 'Request too large' : '服務暫時無法使用，請稍後再試' }, error.message === 'BODY_TOO_LARGE' ? 413 : 503);
      console.error(JSON.stringify({ code: error.message === 'BODY_TOO_LARGE' ? 'BODY_TOO_LARGE' : 'REQUEST_FAILED' }));
    }
    if (origin && origin === env.PUBLIC_ORIGIN && url.pathname.startsWith('/api/')) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Vary', 'Origin');
    }
    return response;
  }
};
