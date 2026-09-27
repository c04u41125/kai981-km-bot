// 官方 Facebook 公告連結的公開試算表；不讀取群組聊天、不使用生成式 AI。
export const G3_SOURCES = [
  { id: '16J7KBQ-B_aCf-0Hc9fhHBkT7e6XfhA2bFJehqGnmkwY', name: 'Funbox' },
  { id: '1MSSZJZKCqDWmPcfIuI4iNLNXU0nyD2VIAU0gr0iBzv8', name: 'B4合作據點' },
  { id: '1Y3jb2TJx8HHCBEHhXM8ugX3IUpSDD_hY-BZ6f3HVloo', name: '夾子園' }
];
const REGIONS = ['嘉義市', '新北市樹林區', '宜蘭縣'];
const sql = (db, query, ...values) => db.prepare(query).bind(...values);
const local = now => new Date(now + 8 * 3600000);
const day = date => date.toISOString().slice(0, 10);
const pad = n => String(n).padStart(2, '0');
const sourceURL = source => 'https://docs.google.com/spreadsheets/d/' + source.id + '/edit';
const guard = 'EXISTS(SELECT 1 FROM g3_state WHERE id=1 AND lease_owner=? AND lease_until>unixepoch())';

function csv(text) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (c === ',' || c === '\n')) {
      row.push(cell.replace(/\r/g, '').trim()); cell = '';
      if (c === '\n') { rows.push(row); row = []; }
    } else cell += c;
  }
  if (quoted) throw new Error('G3_INVALID_CSV');
  if (cell || row.length) { row.push(cell.replace(/\r/g, '').trim()); rows.push(row); }
  return rows;
}

async function readSource(source, now) {
  const response = await fetch('https://docs.google.com/spreadsheets/d/' + source.id + '/export?format=csv',
    { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error('G3_SOURCE_UNAVAILABLE');
  const text = await response.text();
  if (text.length > 2000000 || /<html/i.test(text)) throw new Error('G3_SOURCE_FORMAT');
  const rows = csv(text);
  const title = rows.slice(0, 5).flat().find(c => /G3/.test(c) && /20\d{2}/.test(c));
  const period = title?.match(/(20\d{2})\s*(\d{1,2})\s*[~～\-–]\s*(\d{1,2})/);
  if (!period) throw new Error('G3_PERIOD_MISSING');
  const year = Number(period[1]), first = Number(period[2]), last = Number(period[3]);
  const today = local(now), expected = today.getUTCMonth() + 1;
  const oddMonth = expected % 2 ? expected : expected - 1;
  if (year !== today.getUTCFullYear() || first !== oddMonth || last !== first + 1) throw new Error('G3_PERIOD_STALE');
  const headerIndex = rows.findIndex(r => r.includes('店家地址') && r.includes('店家名稱'));
  if (headerIndex < 0) throw new Error('G3_HEADER_CHANGED');
  const header = rows[headerIndex];
  const index = (...names) => { const i = header.findIndex(c => names.includes(c)); if (i < 0) throw new Error('G3_HEADER_CHANGED'); return i; };
  const cols = { venue: index('店家名稱'), address: index('店家地址'), date: index('活動日期', '日期'),
    time: index('活動時間'), phone: index('連絡電話', '店家連絡電話'), capacity: index('人數上限', '報名人數'),
    registration: index('報名方式'), division: index('賽制') };
  const events = [];
  let datedRows = 0;
  for (const row of rows.slice(headerIndex + 1)) {
    const address = (row[cols.address] || '').normalize('NFKC').replace(/\s/g, '');
    const region = REGIONS.find(r => address.includes(r));
    const rawDate = row[cols.date] || '';
    if (/^(?:20\d{2}\/)?\d{1,2}\/\d{1,2}$/.test(rawDate)) datedRows++;
    if (!region) continue;
    const match = rawDate.match(/^(?:(20\d{2})\/)?(\d{1,2})\/(\d{1,2})$/);
    if (!match) throw new Error('G3_DATE_INVALID');
    const y = match[1] ? Number(match[1]) : year, m = Number(match[2]), d = Number(match[3]);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (y !== year || m < first || m > last || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) throw new Error('G3_DATE_INVALID');
    const time = (row[cols.time] || '').normalize('NFKC');
    if (!/^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('G3_TIME_INVALID');
    const venue = row[cols.venue];
    if (!venue) throw new Error('G3_VENUE_MISSING');
    const event = { source_id: source.id, source_url: sourceURL(source), region,
      venue: source.name === '夾子園' ? '夾子園 ' + venue : venue, address, event_date: day(date),
      event_time: time.padStart(5, '0'), phone: row[cols.phone] || '未提供',
      capacity: row[cols.capacity] || '未提供', registration: row[cols.registration] || '未提供',
      division: row[cols.division] || '未提供' };
    // 場地、日期、時間與賽制相同的資料不重複；不以可能變動的列號識別。
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([event.address, event.venue, event.event_date, event.event_time, event.division])));
    event.id = Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
    events.push(event);
  }
  if (!datedRows) throw new Error('G3_SOURCE_EMPTY');
  return { start: year + '-' + pad(first) + '-01',
    end: day(new Date(Date.UTC(year, last, 0))), events };
}

async function refresh(db, owner, now) {
  // 任一來源失敗即保留整批舊資料，避免誤認某地區沒有賽事。
  const snapshots = await Promise.all(G3_SOURCES.map(source => readSource(source, now)));
  const events = new Map(snapshots.flatMap(s => s.events).map(e => [e.id, e]));
  const queries = [sql(db, 'UPDATE g3_events SET active=0 WHERE ' + guard, owner)];
  for (const e of events.values()) {
    queries.push(sql(db, 'INSERT INTO g3_events(id,source_id,source_url,region,venue,address,event_date,event_time,phone,capacity,registration,division) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ' + guard +
      ' ON CONFLICT(id) DO UPDATE SET source_id=excluded.source_id,source_url=excluded.source_url,phone=excluded.phone,capacity=excluded.capacity,registration=excluded.registration,active=1,updated_at=unixepoch()',
      e.id,e.source_id,e.source_url,e.region,e.venue,e.address,e.event_date,e.event_time,e.phone,e.capacity,e.registration,e.division,owner));
  }
  queries.push(sql(db, 'UPDATE g3_state SET period_start=?,period_end=?,last_success=unixepoch(),last_error=NULL,refresh_day=? WHERE id=1 AND ' + guard,
    snapshots[0].start, snapshots[0].end, day(local(now)), owner));
  await db.batch(queries);
}

export async function g3Status(db) {
  const state = await db.prepare('SELECT period_start,period_end,last_success,last_error FROM g3_state WHERE id=1').first();
  const count = await db.prepare('SELECT COUNT(*) AS count FROM g3_events WHERE active=1').first();
  return { ...state, events: count.count, regions: REGIONS, timezone: 'Asia/Taipei',
    weekly_push: '星期一 09:00', sources: G3_SOURCES.map(s => ({ name: s.name, url: sourceURL(s) })) };
}

export async function g3Weekend(db, now = Date.now()) {
  const today = local(now);
  const monday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (today.getUTCDay() + 6) % 7));
  const saturday = new Date(monday.getTime() + 5 * 86400000), sunday = new Date(monday.getTime() + 6 * 86400000);
  const state = await g3Status(db);
  const header = 'G3 本週末賽事｜' + day(saturday) + '～' + day(sunday) + '\n嘉義市／新北市樹林區／宜蘭縣（台灣時間）';
  const links = '\n\n官方賽程來源：\n' + state.sources.map(s => s.name + '：' + s.url).join('\n');
  if (!state.last_success || state.last_error || state.period_start > day(saturday) || state.period_end < day(sunday)) {
    return { week: day(monday), text: header + '\n目前沒有已確認資料：賽程來源未更新、讀取失敗或尚未完整涵蓋本週末。請核對官方時間表。' + links };
  }
  const rows = (await sql(db, 'SELECT * FROM g3_events WHERE active=1 AND event_date BETWEEN ? AND ? ORDER BY event_date,event_time,region,venue',day(saturday),day(sunday)).all()).results;
  const blocks = rows.map(e => e.event_date + ' ' + e.event_time + '｜' + e.region + '\n' + e.venue + '｜' + e.division +
    '\n地址：' + e.address + '\n名額：' + e.capacity + '｜報名：' + e.registration + '\n店家電話：' + e.phone);
  return { week: day(monday), text: header + '\n\n' + (blocks.length ? blocks.join('\n\n') : '已核對三份官方時間表，目前未列出符合地區的週六、日賽事。') +
    '\n\n賽程可能異動；實際報名方式、名額以店家公告為準。此通知不代表已完成報名。' + links };
}

async function enqueue(db, owner, now) {
  const summary = await g3Weekend(db, now);
  const chunks = [];
  let text = '';
  for (const line of summary.text.split('\n')) {
    if (text.length + line.length > 4000) { chunks.push(text); text = ''; }
    text += line + '\n';
  }
  if (text) chunks.push(text);
  const targets = (await sql(db, 'SELECT target_id FROM monitor_subscriptions s WHERE enabled=1 AND NOT EXISTS(SELECT 1 FROM g3_outbox o WHERE o.target_id=s.target_id AND o.week_start=?)', summary.week).all()).results;
  for (const target of targets) {
    await db.batch(chunks.map((message, part) => sql(db,
      'INSERT INTO g3_outbox(target_id,week_start,part,message,retry_key) SELECT ?,?,?,?,? WHERE ' + guard +
      ' ON CONFLICT(target_id,week_start,part) DO NOTHING',
      target.target_id,summary.week,part,message,crypto.randomUUID(),owner)));
  }
}

// 每個 outbox 使用獨立且持久的 UUID，網路中斷後不重新產生。
async function deliver(db, env, owner) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) return;
  await db.prepare("UPDATE g3_outbox SET status='failed' WHERE status='pending' AND first_attempt<unixepoch()-82800").run();
  await db.prepare("UPDATE g3_outbox SET status='cancelled' WHERE status='pending' AND NOT EXISTS(SELECT 1 FROM monitor_subscriptions s WHERE s.target_id=g3_outbox.target_id AND enabled=1)").run();
  const rows = (await db.prepare("SELECT * FROM g3_outbox WHERE status='pending' ORDER BY id LIMIT 5").all()).results;
  for (const row of rows) {
    const claim = await sql(db, "UPDATE g3_outbox SET first_attempt=COALESCE(first_attempt,unixepoch()) WHERE id=? AND status='pending' AND " + guard + ' RETURNING retry_key',
      row.id,owner).first();
    if (!claim) break;
    try {
      const response = await fetch('https://api.line.me/v2/bot/message/push', {
        method:'POST', headers:{Authorization:'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN,'Content-Type':'application/json','X-Line-Retry-Key':claim.retry_key},
        body:JSON.stringify({to:row.target_id,messages:[{type:'text',text:row.message}]}),signal:AbortSignal.timeout(10000)
      });
      const accepted = response.ok || (response.status === 409 && !!response.headers.get('x-line-accepted-request-id'));
      await sql(db,'UPDATE g3_outbox SET status=?,last_http_status=? WHERE id=?', accepted?'sent':[400,404].includes(response.status)?'failed':'pending',response.status,row.id).run();
      if (!accepted) break;
    } catch { break; }
  }
}

export async function scheduledG3(env, now = Date.now()) {
  const db = env.DB.withSession('first-primary'), owner = crypto.randomUUID();
  const state = await sql(db,'UPDATE g3_state SET lease_owner=?,lease_until=unixepoch()+240 WHERE id=1 AND lease_until<unixepoch() RETURNING *',owner).first();
  if (!state) return;
  try {
    const date = local(now), today = day(date), monday = date.getUTCDay() === 1;
    const firstOdd = date.getUTCDate() === 1 && (date.getUTCMonth() + 1) % 2 === 1;
    const refreshDue = !state.last_success || state.last_error || ((monday || firstOdd) && date.getUTCHours() >= 8 && state.refresh_day !== today);
    if (refreshDue && now/1000 - state.last_attempt >= 3600) {
      await sql(db,'UPDATE g3_state SET last_attempt=unixepoch() WHERE id=1 AND lease_owner=?',owner).run();
      try { await refresh(db,owner,now); }
      catch (error) {
        await sql(db,'UPDATE g3_state SET last_error=? WHERE id=1 AND lease_owner=?',
          /^G3_[A-Z_]+$/.test(error.message)?error.message:'G3_SYNC_FAILED',owner).run();
      }
    }
    // 每週一 09:00 後可補送；資料庫唯一限制防止每五分鐘重複建立通知。
    if (monday && date.getUTCHours() >= 9) await enqueue(db,owner,now);
    await deliver(db,env,owner);
  } finally {
    await sql(db,'UPDATE g3_state SET lease_until=0 WHERE id=1 AND lease_owner=?',owner).run();
  }
}

