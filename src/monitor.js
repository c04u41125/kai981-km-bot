import { browserCatalog } from './monitor-browser.js';
const SOURCE = 'https://shop.funbox.com.tw/categories/XI/KB';
const sql = (db, query, ...args) => db.prepare(query).bind(...args);

export async function monitorStatus(db) {
  const state = await db.prepare("SELECT initialized,last_success,last_error,transport,browser_seconds,browser_day,last_local_success,last_cloud_error FROM monitor_state WHERE id='funbox'").first();
  const count = await db.prepare('SELECT COUNT(*) AS count FROM monitor_products').first();
  const stale = !state.last_success || state.last_success < Date.now()/1000-180;
  return { source: SOURCE, interval_minutes: 1, ...state, stale, health: stale ? 'stale' : state.last_error ? 'error' : 'ok', known_products: count.count, mmtoy: { enabled: false, status: 'disabled' } };
}

// 此指令僅接受已驗證簽章事件；群組目的地不能由文字指定。
export async function monitorCommand(db, env, event, text, plan) {
  const admins = (env.ADMIN_LINE_USER_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!admins.includes(event.source.userId)) return plan.commit('管理操作已拒絕：需要管理員白名單。');
  const target = event.source.type === 'group' ? event.source.groupId : null;
  if (!target) return plan.commit('請管理員在要接收通知的 LINE 群組輸入「/monitor on」、「/monitor off」或「/monitor status」。');
  if (text === '/monitor status') {
    const state = await monitorStatus(db);
    const sub = await sql(db, 'SELECT enabled FROM monitor_subscriptions WHERE target_id=?', target).first();
    const pending = await sql(db, "SELECT COUNT(*) AS count FROM monitor_outbox WHERE target_id=? AND status='pending' AND product_id NOT LIKE 'mm:%'", target).first();
    const failed = await sql(db, "SELECT COUNT(*) AS count FROM monitor_outbox WHERE target_id=? AND status='failed' AND product_id NOT LIKE 'mm:%'", target).first();
    return plan.commit(`Funbox 新品監測\n本群組：${sub?.enabled ? '已訂閱' : '未訂閱'}\n每分鐘檢查，非即時保證。\n讀取方式：${state.transport === 'local' ? '本機備援（電腦須開機連網）' : state.transport === 'browser' ? '瀏覽器備援（每日額度有限）' : '雲端直接讀取'}\n已記錄：${state.known_products} 件\n最後成功：${state.last_success ? new Date(state.last_success * 1000).toLocaleString('zh-TW',{timeZone:'Asia/Taipei',hour12:false}) : '尚未完成'}\n狀態：${state.stale ? '已超過 3 分鐘未更新；可能漏報。' : ''}${state.last_error || (state.stale ? '' : '正常')}\n待送：${pending.count}，失敗：${failed.count}\n來源：${SOURCE}`);
  }
  if (!['/monitor on','/monitor off'].includes(text)) return plan.commit('監測指令：/monitor on、/monitor off、/monitor status。');
  const enabled = text.endsWith(' on') ? 1 : 0;
  plan.add(`INSERT INTO monitor_subscriptions(target_id,enabled,actor_user_id) SELECT ?,?,? WHERE ${plan.guard}
    ON CONFLICT(target_id) DO UPDATE SET enabled=excluded.enabled,actor_user_id=excluded.actor_user_id,updated_at=unixepoch()`, target, enabled, event.source.userId, event.webhookEventId);
  if (!enabled) plan.add(`UPDATE monitor_outbox SET status='cancelled' WHERE target_id=? AND status='pending' AND ${plan.guard}`, target, event.webhookEventId);
  plan.add(`INSERT INTO admin_audit(event_id,actor_user_id,action) SELECT ?,?,? WHERE ${plan.guard}`, event.webhookEventId, event.source.userId, enabled ? 'monitor_on' : 'monitor_off', event.webhookEventId);
  return plan.commit(enabled ? '本群組已訂閱 Funbox 新品通知。每分鐘檢查；首次建立基準，不推播既有商品。通知代表分類首次發現，並非保證可購買。' : '本群組已停止新品通知並取消待送訊息；已在傳送中的訊息可能仍會送達。');
}

async function sourceFetch(url, options) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, {...options, cache:'no-store', signal:AbortSignal.timeout(10000)});
    if (![403,502,503,504].includes(response.status) || attempt === 2) return response;
    await response.body?.cancel();
    await new Promise(resolve => setTimeout(resolve, attempt === 0 ? 1000 : 3000));
  }
}

async function catalog(fetcher = sourceFetch) {
  const products = new Map();
  for (let page = 1; page <= 20; page++) {
    const response = await fetcher(`https://shop.funbox.com.tw/category_products/XI/KB?limit=18&page=${page}&sort_by=sell_from-desc`, {
      headers: { Accept: 'application/json', Referer: SOURCE, 'Cache-Control':'no-cache', 'User-Agent':'Mozilla/5.0 (compatible; KAI981Monitor/1.1; +https://c04u41125.github.io/kai981-km-bot/)' }, signal: AbortSignal.timeout(15000)
    }).catch(() => { throw new Error('SOURCE_NETWORK_ERROR'); });
    if (!response.ok) { await response.body?.cancel(); throw new Error('SOURCE_HTTP_' + response.status); }
    const finalUrl = new URL(response.url);
    if (finalUrl.origin !== 'https://shop.funbox.com.tw' || !finalUrl.pathname.startsWith('/category_products/')) throw new Error('SOURCE_REDIRECT');
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('SOURCE_FORMAT_CHANGED');
    const raw = await response.text();
    if (raw.length > 2000000) throw new Error('SOURCE_TOO_LARGE');
    let rows;
    try { rows = JSON.parse(raw); } catch { throw new Error('SOURCE_INVALID_JSON'); }
    if (!Array.isArray(rows) || rows.length > 18) throw new Error('SOURCE_FORMAT_CHANGED');
    for (const row of rows) {
      if (!Number.isSafeInteger(row.id) || row.id <= 0 || typeof row.title !== 'string' || !row.title.trim() || row.title.length > 500 || typeof row.url !== 'string') throw new Error('SOURCE_FORMAT_CHANGED');
      const url = new URL(row.url, SOURCE);
      if (url.origin !== 'https://shop.funbox.com.tw' || !url.pathname.startsWith('/products/') || url.username || url.password) throw new Error('SOURCE_FORMAT_CHANGED');
      if (products.has(String(row.id))) throw new Error('SOURCE_PAGINATION_CHANGED');
      const rawPrice = row.price ?? row.variants?.[0]?.price;
      const price = rawPrice !== null && rawPrice !== undefined && rawPrice !== '' && Number.isFinite(Number(rawPrice)) && Number(rawPrice) >= 0 ? `NT$${Number(rawPrice).toLocaleString('en-US')}` : '未提供';
      products.set(String(row.id), { id: String(row.id), title: row.title.trim(), url: url.href, price });
    }
    if (rows.length < 18) {
      // 第一頁空分類才是來源異常；後續空頁代表已掃描完畢。
      if (!products.size) throw new Error('SOURCE_EMPTY');
      return [...products.values()];
    }
  }
  throw new Error('SOURCE_PAGE_LIMIT');
}

async function scan(db, owner, env) {
  let products, transport = 'http';
  try { products = await catalog(); }
  catch(error) {
    if (!/^SOURCE_HTTP_(403|429|5\d\d)$/.test(error.message)) throw error;
    // Reserve a bounded allowance before launching; retain it even on interruption.
    const today = new Date().toISOString().slice(0,10);
    const allowed = await sql(db, `UPDATE monitor_state SET browser_seconds=CASE WHEN browser_day=? THEN browser_seconds+45 ELSE 45 END,browser_day=?
      WHERE id='funbox' AND lease_owner=? AND (browser_day IS NULL OR browser_day<>? OR browser_seconds<=435) RETURNING id`,today,today,owner,today).first();
    if (!allowed) throw Error('SOURCE_BROWSER_DAILY_LIMIT');
    products = await browserCatalog(env,catalog);
    transport = 'browser';
  }
  await persistCatalog(db,owner,products,transport);
}

async function persistCatalog(db, owner, products, transport, observedAt = 0) {
  const queries = [];
  const guard = "EXISTS(SELECT 1 FROM monitor_state WHERE id='funbox' AND lease_owner=? AND lease_until>unixepoch())";
  for (const p of products) {
    // 全部頁面成功才交易提交；首次不建立通知。從未出現的 ID 才算新品。
    queries.push(sql(db, `INSERT INTO monitor_outbox(target_id,product_id,message,retry_key)
      SELECT target_id,?,?,lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))
      FROM monitor_subscriptions WHERE enabled=1 AND ${guard}
      AND EXISTS(SELECT 1 FROM monitor_state WHERE id='funbox' AND initialized=1)
      AND NOT EXISTS(SELECT 1 FROM monitor_products WHERE product_id=?)
      ON CONFLICT(target_id,product_id) DO NOTHING`, p.id, `FUNBOX官網監控/${p.title}/${p.price}/${p.url}`, owner, p.id));
    queries.push(sql(db, `INSERT INTO monitor_products(product_id,title,url,price) SELECT ?,?,?,? WHERE ${guard}
      ON CONFLICT(product_id) DO UPDATE SET title=excluded.title,url=excluded.url,price=excluded.price`, p.id, p.title, p.url, p.price, owner));
  }
  queries.push(sql(db, `UPDATE monitor_state SET initialized=1,last_success=unixepoch(),last_error=NULL,transport=? WHERE id='funbox' AND lease_owner=? AND lease_until>unixepoch()`, transport, owner));
  if (transport === 'local') queries.push(sql(db, `UPDATE monitor_state SET last_local_success=unixepoch(),last_local_observed=? WHERE id='funbox' AND lease_owner=? AND lease_until>unixepoch()`,observedAt,owner));
  try { await db.batch(queries); }
  catch (error) {
    // 本區僅有公開商品 SQL，不包含 LINE 憑證或收件者值。
    console.error(JSON.stringify({ code: 'MONITOR_DATABASE_ERROR', detail: String(error.message).slice(0, 200) }));
    throw new Error('SOURCE_DATABASE_ERROR');
  }
}

export async function acceptMonitorSnapshot(raw, signature, env, db) {
  const reply = (data,status=200) => Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
  if (!env.MONITOR_RELAY_SECRET || !/^[A-Za-z0-9+/]{43}=$/.test(signature || '')) return reply({error:'Unauthorized'},401);
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(env.MONITOR_RELAY_SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  if (!await crypto.subtle.verify('HMAC',key,Uint8Array.from(atob(signature),c=>c.charCodeAt(0)),raw)) return reply({error:'Unauthorized'},401);
  let snapshot;
  try { snapshot = JSON.parse(new TextDecoder().decode(raw)); } catch { return reply({error:'Invalid JSON'},400); }
  if (!Number.isSafeInteger(snapshot.observedAt) || Math.abs(Date.now()-snapshot.observedAt)>120000 || !Array.isArray(snapshot.pages) || snapshot.pages.length<1 || snapshot.pages.length>20) return reply({error:'Invalid snapshot'},400);
  let used = 0, products;
  try {
    products = await catalog(async url => ({ok:true,url,headers:new Headers({'content-type':'application/json'}),text:async()=>JSON.stringify(snapshot.pages[used++])}));
    if (used !== snapshot.pages.length) throw Error('EXTRA_PAGES');
  } catch { return reply({error:'Incomplete or invalid catalog'},400); }
  const owner = crypto.randomUUID();
  const claimed = await sql(db, `UPDATE monitor_state SET lease_owner=?,lease_until=unixepoch()+60 WHERE id='funbox' AND lease_until<unixepoch() AND last_local_observed<? RETURNING id`,owner,snapshot.observedAt).first();
  if (!claimed) return reply({error:'Busy or stale snapshot'},409);
  try {
    await persistCatalog(db,owner,products,'local',snapshot.observedAt);
    await deliver(db,env,owner);
    return reply({ok:true,products:products.length});
  } finally {
    await sql(db,"UPDATE monitor_state SET lease_until=0 WHERE id='funbox' AND lease_owner=?",owner).run();
  }
}

async function deliver(db, env, owner) {
  await db.prepare("UPDATE monitor_outbox SET status='cancelled' WHERE product_id LIKE 'mm:%' AND status='pending'").run();
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) return;
  // LINE retry key 有效期為 24 小時；23 小時後停止自動重試，以免重複推播。
  await db.prepare("UPDATE monitor_outbox SET status='failed' WHERE status='pending' AND first_attempt<unixepoch()-82800").run();
  const rows = (await db.prepare("SELECT * FROM monitor_outbox WHERE status='pending' AND product_id NOT LIKE 'mm:%' ORDER BY id LIMIT 5").all()).results;
  for (const row of rows) {
    const claim = await sql(db, `UPDATE monitor_outbox SET attempts=attempts+1,first_attempt=COALESCE(first_attempt,unixepoch())
      WHERE id=? AND status='pending' AND EXISTS(SELECT 1 FROM monitor_subscriptions WHERE target_id=? AND enabled=1)
      AND EXISTS(SELECT 1 FROM monitor_state WHERE id='funbox' AND lease_owner=? AND lease_until>unixepoch()+15) RETURNING id`, row.id, row.target_id, owner).first();
    if (!claim) continue;
    try {
      const response = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST', headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`, 'Content-Type': 'application/json', 'X-Line-Retry-Key': row.retry_key },
        body: JSON.stringify({ to: row.target_id, messages: [{ type: 'text', text: row.message }] }), signal: AbortSignal.timeout(10000)
      });
      const accepted = response.ok || (response.status === 409 && !!response.headers.get('x-line-accepted-request-id'));
      const status = accepted ? 'sent' : [400,404].includes(response.status) ? 'failed' : 'pending';
      await sql(db, 'UPDATE monitor_outbox SET status=?,last_http_status=? WHERE id=? AND status=\'pending\'', status, response.status, row.id).run();
      if ([401,403,429].includes(response.status)) break;
    } catch { console.warn(JSON.stringify({ code: 'MONITOR_PUSH_RETRY' })); }
  }
}

export async function scheduledMonitor(env) {
  const db = env.DB.withSession('first-primary');
  const owner = crypto.randomUUID();
  const claimed = await sql(db, "UPDATE monitor_state SET lease_owner=?,lease_until=unixepoch()+300 WHERE id='funbox' AND lease_until<unixepoch() RETURNING id", owner).first();
  if (!claimed) return;
  try {
    // A recent signed local snapshot already covers this minute; keep delivering the outbox.
    const recent = await db.prepare("SELECT last_local_success FROM monitor_state WHERE id='funbox'").first();
    try { if (!recent.last_local_success || recent.last_local_success < Date.now()/1000-90) await scan(db, owner, env); }
    catch (error) {
      const code = /^SOURCE_[A-Z_0-9]+$/.test(error.message) ? error.message : 'MONITOR_SCAN_FAILED';
      await sql(db, "UPDATE monitor_state SET last_error=?,last_cloud_error=? WHERE id='funbox' AND lease_owner=?", code, code, owner).run();
      console.warn(JSON.stringify({ code }));
    }
    await deliver(db, env, owner);
  } finally {
    await sql(db, "UPDATE monitor_state SET lease_until=0 WHERE id='funbox' AND lease_owner=?", owner).run();
  }
}
