import { discoverG3, discoveryLabel } from './g3-discovery.js';
// 官方 Facebook 公告連結的公開試算表；不讀取群組聊天、不使用生成式 AI。
export const G3_SOURCES = [
  { id: '16J7KBQ-B_aCf-0Hc9fhHBkT7e6XfhA2bFJehqGnmkwY', name: 'Funbox', year: 2026, first: 9 },
  { id: '1MSSZJZKCqDWmPcfIuI4iNLNXU0nyD2VIAU0gr0iBzv8', name: 'B4合作據點', year: 2026, first: 9 },
  { id: '1Y3jb2TJx8HHCBEHhXM8ugX3IUpSDD_hY-BZ6f3HVloo', name: '夾子園', year: 2026, first: 9 },
  { id: '1T4as64A4LiAUmTD4pRP5bz00ifJdt3isGCL9jcQgNCk', name: 'Funbox', year: 2026, first: 11 },
  { id: '1ec0T7LyN3DlfBhrsSJTRXqWEA8Q1fTmqIfMtSAcoxpo', name: 'B4合作據點', year: 2026, first: 11 },
  { id: '1Mdkmg4aIFuy6MBOR8J3kr7Iagmptp2CKH506bmdM6dM', name: '夾子園', year: 2026, first: 11 }
];
const REGIONS = ["基隆市", "臺北市", "新北市", "桃園市", "新竹市", "新竹縣", "苗栗縣", "臺中市", "彰化縣", "南投縣", "雲林縣", "嘉義市", "嘉義縣", "臺南市", "高雄市", "屏東縣", "宜蘭縣", "花蓮縣", "臺東縣", "澎湖縣", "金門縣", "連江縣"];
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

// Keep the previous period during a crossing weekend; import verified future periods early.
async function activeSources(db, now = Date.now()) {
  const date = local(now);
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - (date.getUTCDay() + 6) % 7));
  const stored = (await db.prepare('SELECT sheet_id AS id,name,year,first FROM g3_sources ORDER BY year,first,name').all()).results;
  return stored.filter(s => Date.UTC(s.year, s.first + 1, 0) >= monday.getTime());
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
  const kind = /B4/.test(title) ? 'B4合作據點' : /門市/.test(title) ? 'Funbox' : /官方G3活動時間.*通路版本/.test(title) ? '夾子園' : null;
  if (kind !== source.name) throw new Error('G3_HEADER_CHANGED');
  const year = Number(period[1]), first = Number(period[2]), last = Number(period[3]);
  if (year !== source.year || first !== source.first || last !== first + 1) throw new Error('G3_PERIOD_STALE');
  const headerIndex = rows.findIndex(r => r.includes('店家地址') && r.includes('店家名稱'));
  if (headerIndex < 0) throw new Error('G3_HEADER_CHANGED');
  const header = rows[headerIndex];
  const index = (...names) => { const i = header.findIndex(c => names.includes(c)); if (i < 0) throw new Error('G3_HEADER_CHANGED'); return i; };
  const cols = { venue: index('店家名稱'), address: index('店家地址'), date: index('活動日期', '日期'),
    time: index('活動時間'), phone: index('連絡電話', '店家連絡電話'), capacity: index('人數上限', '報名人數'),
    registration: index('報名方式'), division: index('賽制') };
  const events = [], warnings = [];
  let datedRows = 0;
  for (const row of rows.slice(headerIndex + 1)) {
    const address = (row[cols.address] || '').normalize('NFKC').replace(/\s/g, '');
    const canonical = address.replace(/台/g, '臺').replace('高雄縣','高雄市').replace('臺中縣','臺中市').replace('臺南縣','臺南市').replace('桃園縣','桃園市').replace('臺北縣','新北市');
    const region = REGIONS.find(r => canonical.includes(r));
    const originalDate = row[cols.date] || '';
    const rawDate = originalDate.normalize('NFKC').replace(/\s/g, '').replace(/\(原[^()]*場次[^()]*\)$/, '');
    if (/^(?:20\d{2}\/)?\d{1,2}\/\d{1,2}$/.test(rawDate)) datedRows++;
    if (!region) continue;
    const match = rawDate.match(/^(?:(20\d{2})\/)?(\d{1,2})\/(\d{1,2})$/);
    if (!match) throw new Error('G3_DATE_INVALID');
    const y = match[1] ? Number(match[1]) : year, m = Number(match[2]), d = Number(match[3]);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) throw new Error('G3_DATE_INVALID');
    if (y !== year) { warnings.push({ source: source.name, url: sourceURL(source), venue: row[cols.venue], region, address, date: originalDate, reason: '年份與表單期間不符，未匯入' }); continue; }
    // Out-of-period rows belong to the corresponding official period, not this sheet.
    if (m < first || m > last) continue;
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
    end: day(new Date(Date.UTC(year, last, 0))), events, warnings };
}

async function refresh(db, owner, now) {
  // 任一來源失敗即保留整批舊資料，避免誤認某地區沒有賽事。
  const sources = await activeSources(db,now);
  if (!sources.length) throw new Error('G3_PERIOD_STALE');
  const snapshots = await Promise.all(sources.map(source => readSource(source, now)));
  const periods = [...new Map(snapshots.map(s => [s.start, s])).values()].sort((a,b) => a.start.localeCompare(b.start));
  for (let i=1; i<periods.length; i++) {
    if (Date.parse(periods[i].start) !== Date.parse(periods[i-1].end) + 86400000) throw new Error('G3_PERIOD_GAP');
  }
  const events = new Map(snapshots.flatMap(s => s.events).map(e => [e.id, e]));
  const queries = [sql(db, 'UPDATE g3_events SET active=0 WHERE ' + guard, owner)];
  for (const e of events.values()) {
    queries.push(sql(db, 'INSERT INTO g3_events(id,source_id,source_url,region,venue,address,event_date,event_time,phone,capacity,registration,division) SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ' + guard +
      ' ON CONFLICT(id) DO UPDATE SET region=excluded.region,source_id=excluded.source_id,source_url=excluded.source_url,phone=excluded.phone,capacity=excluded.capacity,registration=excluded.registration,active=1,updated_at=unixepoch()',
      e.id,e.source_id,e.source_url,e.region,e.venue,e.address,e.event_date,e.event_time,e.phone,e.capacity,e.registration,e.division,owner));
  }
  queries.push(sql(db, 'UPDATE g3_state SET period_start=?,period_end=?,last_success=unixepoch(),last_error=NULL,refresh_day=?,warnings_json=? WHERE id=1 AND ' + guard,
    periods[0].start, periods.at(-1).end, day(local(now)), JSON.stringify(snapshots.flatMap(s => s.warnings)), owner));
  await db.batch(queries);
}

export async function g3Status(db) {
  const state = await db.prepare('SELECT period_start,period_end,last_success,last_error,last_attempt,refresh_requested,refresh_handled,weekly_ready,warnings_json,discovery_attempt,discovery_success,discovery_error,discovery_post,discovery_period FROM g3_state WHERE id=1').first();
  const count = await db.prepare('SELECT COUNT(*) AS count FROM g3_events WHERE active=1').first();
  return { ...state, discovery_message: state.discovery_error ? discoveryLabel(state.discovery_error) : state.discovery_success ? '已核對公開公告' : '尚未檢查', warnings: JSON.parse(state.warnings_json || '[]'), events: count.count, regions: REGIONS, timezone: 'Asia/Taipei',
    weekly_push: '星期一 09:00', sources: (await activeSources(db)).map(s => ({ name: s.name + ' ' + s.year + '/' + s.first + '–' + (s.first+1), url: sourceURL(s) })) };
}

const REGION_QUERIES = Object.fromEntries(REGIONS.flatMap(r => [[r,[r]], [r.slice(0,-1),[r]]]));
REGION_QUERIES['嘉義'] = ['嘉義市','嘉義縣'];
REGION_QUERIES['新竹'] = ['新竹市','新竹縣'];
REGION_QUERIES['馬祖'] = ['連江縣'];
for (const key of ['樹林','樹林區','新北市樹林區']) REGION_QUERIES[key] = ['新北市樹林區'];
function matchesRegion(row, region) {
  return region === '新北市樹林區' ? row.region === '新北市' && row.address.includes('樹林區') : row.region === region;
}

export async function g3RegionReply(db, text) {
  const command = text.normalize('NFKC').replace(/\s/g, '').replace(/台/g,'臺');
  const match = command.match(/^(?:本週)?(.+?)G3$/i) || command.match(/^G3(.+)$/i);
  if (!match) return null;
  const regions = REGION_QUERIES[match[1]];
  if (!regions) return '支援全台 22 縣市 G3 查詢，例如：臺北G3、新北G3、臺中G3、高雄G3。嘉義、新竹可加縣／市；未加時顯示兩者。樹林G3仍可查詢樹林區。';
  return await g3Weekend(db, Date.now(), regions);
}

export async function g3Weekend(db, now = Date.now(), regions = REGIONS) {
  const today = local(now);
  const monday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (today.getUTCDay() + 6) % 7));
  const saturday = new Date(monday.getTime() + 5 * 86400000), sunday = new Date(monday.getTime() + 6 * 86400000);
  const state = await g3Status(db);
  const header = 'G3 本週末賽事｜' + day(saturday) + '～' + day(sunday) + '\n' + regions.join('／') + '（台灣時間）';
  const links = '\n\n官方賽程來源：\n' + state.sources.map(s => s.name + '：' + s.url).join('\n');
  if (!state.last_success || state.last_error || state.period_start > day(saturday) || state.period_end < day(sunday)) {
    return { week: day(monday), available: false, start: day(saturday), end: day(sunday), regions, rows: [], sources: state.sources, text: header + '\n目前沒有已確認資料：賽程來源未更新、讀取失敗或尚未完整涵蓋本週末。請核對官方時間表。' + links };
  }
  const rows = (await sql(db, 'SELECT * FROM g3_events WHERE active=1 AND event_date BETWEEN ? AND ? ORDER BY event_date,event_time,region,venue',day(saturday),day(sunday)).all()).results;
  const warnings = state.warnings.filter(e => regions.some(region => matchesRegion(e,region)));
  const blocks = rows.filter(e => regions.some(region => matchesRegion(e, region))).map(e => e.event_date + ' ' + e.event_time + '｜' + e.region + '\n' + e.venue + '｜' + e.division +
    '\n地址：' + e.address + '\n名額：' + e.capacity + '｜報名：' + e.registration + '\n店家電話：' + e.phone);
  return { week: day(monday), available: true, warnings, start: day(saturday), end: day(sunday), regions, rows: rows.filter(e => regions.some(region => matchesRegion(e, region))), sources: state.sources, updated: state.last_success, text: header + (warnings.length ? '\n注意：有 '+warnings.length+' 筆官方日期年份異常未列入，請核對官方表單。' : '') + '\n\n' + (blocks.length ? blocks.join('\n\n') : '已核對官方時間表，目前未列出符合地區的週六、日賽事。') +
    '\n\n賽程可能異動；實際報名方式、名額以店家公告為準。此通知不代表已完成報名。' + links };
}

async function enqueue(db, owner, now) {
  const summary = await g3Weekend(db, now);
  if (!summary.available) return;
  const chunks = [summary.text.slice(0, 4700)];
  const messages = JSON.stringify(g3Messages(summary));
  const targets = (await sql(db, 'SELECT target_id FROM monitor_subscriptions s WHERE enabled=1 AND NOT EXISTS(SELECT 1 FROM g3_outbox o WHERE o.target_id=s.target_id AND o.week_start=? AND o.is_schedule=1)', summary.week).all()).results;
  for (const target of targets) {
    await db.batch(chunks.map((message, part) => sql(db,
      'INSERT INTO g3_outbox(target_id,week_start,part,message,retry_key,messages_json,is_schedule) SELECT ?,?,?,?,?,?,1 WHERE ' + guard +
      " ON CONFLICT(target_id,week_start,part) DO UPDATE SET message=excluded.message,messages_json=excluded.messages_json,retry_key=excluded.retry_key,is_schedule=1,status='pending',first_attempt=NULL,last_http_status=NULL WHERE g3_outbox.is_schedule=0",
      target.target_id,summary.week,part,message,crypto.randomUUID(),messages,owner)));
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
        body:JSON.stringify({to:row.target_id,messages:row.messages_json ? JSON.parse(row.messages_json) : [{type:'text',text:row.message}]}),signal:AbortSignal.timeout(10000)
      });
      const accepted = response.ok || (response.status === 409 && !!response.headers.get('x-line-accepted-request-id'));
      await sql(db,'UPDATE g3_outbox SET status=?,last_http_status=? WHERE id=?', accepted?'sent':[400,404].includes(response.status)?'failed':'pending',response.status,row.id).run();
      if (!accepted) break;
    } catch { break; }
  }
}

async function checkAnnouncement(db,env,owner,now,state,week) {
  const today = day(local(now));
  const attempts = state.discovery_day === today ? state.discovery_runs : 0;
  if (attempts >= 6) {
    await sql(db,'UPDATE g3_state SET discovery_attempt=unixepoch(),discovery_error=? WHERE id=1 AND '+guard,'G3_DISCOVERY_DAILY_LIMIT',owner).run();
    return false;
  }
  await sql(db,'UPDATE g3_state SET discovery_attempt=unixepoch(),discovery_day=?,discovery_runs=? WHERE id=1 AND '+guard,today,attempts+1,owner).run();
  try {
    const found = await discoverG3(env,now);
    const latest = await db.prepare('SELECT year,first FROM g3_sources ORDER BY year DESC,first DESC LIMIT 1').first();
    if (latest && found.year*12+found.first < latest.year*12+latest.first) throw Error('G3_DISCOVERY_OLDER');
    try { await Promise.all(found.sources.map(source => readSource(source,now))); }
    catch { throw Error('G3_DISCOVERY_VALIDATION_FAILED'); }
    const queries = found.sources.map(s => sql(db,
      'INSERT INTO g3_sources(year,first,name,sheet_id,post_url) SELECT ?,?,?,?,? WHERE '+guard+
      ' ON CONFLICT(year,first,name) DO UPDATE SET sheet_id=excluded.sheet_id,post_url=excluded.post_url',s.year,s.first,s.name,s.id,found.url,owner));
    queries.push(sql(db,'UPDATE g3_state SET discovery_success=unixepoch(),discovery_error=NULL,discovery_week=?,discovery_post=?,discovery_period=? WHERE id=1 AND '+guard,week,found.url,found.year+'/'+found.first+'–'+(found.first+1),owner));
    await db.batch(queries);
    return true;
  } catch(error) {
    const code = /^G3_DISCOVERY_[A-Z_]+$/.test(error.message) ? error.message : 'G3_DISCOVERY_UNAVAILABLE';
    await sql(db,'UPDATE g3_state SET discovery_error=? WHERE id=1 AND '+guard,code,owner).run();
    return false;
  }
}

export async function scheduledG3(env, now = Date.now()) {
  const db = env.DB.withSession('first-primary'), owner = crypto.randomUUID();
  const state = await sql(db,'UPDATE g3_state SET lease_owner=?,lease_until=unixepoch()+240 WHERE id=1 AND lease_until<unixepoch() RETURNING *',owner).first();
  if (!state) return;
  try {
    const date = local(now), today = day(date);
    const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - (date.getUTCDay() + 6) % 7));
    const week = day(monday);
    // 週一 09:00 起整週保留補送資格；跨週後只公告新一週，避免補送過期賽程。
    const weeklyDue = date.getTime() >= monday.getTime() + 9 * 3600000;
    const firstOdd = date.getUTCDate() === 1 && (date.getUTCMonth() + 1) % 2 === 1;
    const manual = state.refresh_requested > state.refresh_handled;
    const discoveryDue = manual || (weeklyDue && state.discovery_week !== week) || !!state.discovery_error;
    let discovered = false;
    if (discoveryDue && (manual || now/1000-state.discovery_attempt >= 3600)) {
      discovered = await checkAnnouncement(db,env,owner,now,state,week);
    }
    const refreshDue = discovered || manual || !state.last_success || state.last_error ||
      (weeklyDue && state.weekly_ready !== week) ||
      (date.getUTCHours() >= 8 && state.refresh_day !== today) ||
      (firstOdd && date.getUTCHours() >= 8 && state.refresh_day !== today);
    if (refreshDue && (manual || now/1000 - state.last_attempt >= 3600)) {
      await sql(db,'UPDATE g3_state SET last_attempt=unixepoch(),refresh_handled=? WHERE id=1 AND ' + guard,state.refresh_requested,owner).run();
      try {
        await refresh(db,owner,now);
        if (weeklyDue) {
          const summary = await g3Weekend(db,now);
          if (!summary.available) throw new Error('G3_WEEKEND_NOT_COVERED');
          await sql(db,'UPDATE g3_state SET weekly_ready=? WHERE id=1 AND ' + guard,week,owner).run();
        }
      } catch (error) {
        await sql(db,'UPDATE g3_state SET last_error=? WHERE id=1 AND ' + guard,
          /^G3_[A-Z_]+$/.test(error.message)?error.message:'G3_SYNC_FAILED',owner).run();
      }
    }
    const ready = await db.prepare('SELECT weekly_ready,last_error FROM g3_state WHERE id=1').first();
    if (weeklyDue && ready.weekly_ready === week && !ready.last_error) await enqueue(db,owner,now);
    // 上週尚未送出的通知不在新一週補送。
    await sql(db,"UPDATE g3_outbox SET status='cancelled' WHERE status='pending' AND week_start<? AND " + guard,week,owner).run();
    await deliver(db,env,owner);
  } finally {
    await sql(db,'UPDATE g3_state SET lease_until=0 WHERE id=1 AND lease_owner=?',owner).run();
  }
}


const G3_PAGE = 'https://c04u41125.github.io/KAI-981/g3.html';
const txt = (text, size = 'sm', color = '#171918') => ({type:'text',text:String(text),size,color,wrap:true});
export function g3Messages(summary) {
  if (!summary.available) return [{type:'text',text:summary.text.slice(0,4700)}];
  const groups = summary.regions.map(region => ({name:region, regions:[region]}));
  const bubbles = groups.map(g => {
    const rows = summary.rows.filter(r => g.regions.some(region => matchesRegion(r,region)));
    const warnings = (summary.warnings || []).filter(r => g.regions.some(region => matchesRegion(r,region)));
    const uri = G3_PAGE + '?region=' + encodeURIComponent(g.name) + '&week=' + summary.week;
    return {type:'bubble',size:'mega',header:{type:'box',layout:'vertical',backgroundColor:'#171918',spacing:'sm',contents:[txt('迴眾 KAI 9.81 / G3','xs','#D9FF62'),{...txt(g.name + ' · 本週末','xl','#FFFFFF'),weight:'bold'},txt(summary.start + ' — ' + summary.end,'xs','#FFFFFF')]},body:{type:'box',layout:'vertical',spacing:'lg',backgroundColor:'#F0EFE9',contents:[{...txt(rows.length + ' 場官方賽事','xl'),weight:'bold'},txt('星期六 '+rows.filter(r=>r.event_date===summary.start).length+' 場  /  星期日 '+rows.filter(r=>r.event_date===summary.end).length+' 場'),{type:'separator'},...(warnings.length ? [txt('注意：'+warnings.length+' 筆官方日期年份異常未列入，請核對官方來源。','xs','#B42318')] : []),...rows.slice(0,3).map(r=>txt(r.event_date.slice(5)+' '+r.event_time+'｜'+r.venue+' · '+r.division)),txt(rows.length>3?'另有 '+(rows.length-3)+' 場，點下方看完整賽程。':rows.length?'報名方式與名額以店家公告為準。':'已核對來源，本週末未列出此地區場次。','xs','#62665C')]},footer:{type:'box',layout:'vertical',contents:[{type:'button',style:'primary',color:'#344421',action:{type:'uri',label:'查看完整賽程 ↗',uri}}]}};
  });
  // 每組最多 8 張，22 縣市拆成 3 則，低於 LINE 每次 5 則限制。
  const messages = [];
  for (let i=0;i<bubbles.length;i+=8) {
    const contents = bubbles.slice(i,i+8);
    messages.push({type:'flex',altText:'迴眾 G3｜'+summary.start+'～'+summary.end+'｜地區卡片 '+(i+1)+'–'+(i+contents.length),contents:contents.length===1?contents[0]:{type:'carousel',contents}});
  }
  return messages;
}
