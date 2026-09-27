const SOURCE = 'https://shop.funbox.com.tw/categories/XI/KB';
const sql = (db, query, ...args) => db.prepare(query).bind(...args);

export async function monitorStatus(db) {
  const state = await db.prepare("SELECT initialized,last_success,last_error FROM monitor_state WHERE id='funbox'").first();
  const count = await db.prepare('SELECT COUNT(*) AS count FROM monitor_products').first();
  return { source: SOURCE, interval_minutes: 1, ...state, known_products: count.count };
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
    const pending = await sql(db, "SELECT COUNT(*) AS count FROM monitor_outbox WHERE target_id=? AND status='pending'", target).first();
    const failed = await sql(db, "SELECT COUNT(*) AS count FROM monitor_outbox WHERE target_id=? AND status='failed'", target).first();
    return plan.commit(`Funbox 新品監測\n本群組：${sub?.enabled ? '已訂閱' : '未訂閱'}\n每 5 分鐘檢查，非即時保證。\n已記錄：${state.known_products} 件\n最後成功：${state.last_success ? new Date(state.last_success * 1000).toISOString() : '尚未完成'}\n狀態：${state.last_error || '正常'}\n待送：${pending.count}，失敗：${failed.count}\n來源：${SOURCE}`);
  }
  if (!['/monitor on','/monitor off'].includes(text)) return plan.commit('監測指令：/monitor on、/monitor off、/monitor status。');
  const enabled = text.endsWith(' on') ? 1 : 0;
  plan.add(`INSERT INTO monitor_subscriptions(target_id,enabled,actor_user_id) SELECT ?,?,? WHERE ${plan.guard}
    ON CONFLICT(target_id) DO UPDATE SET enabled=excluded.enabled,actor_user_id=excluded.actor_user_id,updated_at=unixepoch()`, target, enabled, event.source.userId, event.webhookEventId);
  if (!enabled) plan.add(`UPDATE monitor_outbox SET status='cancelled' WHERE target_id=? AND status='pending' AND ${plan.guard}`, target, event.webhookEventId);
  plan.add(`INSERT INTO admin_audit(event_id,actor_user_id,action) SELECT ?,?,? WHERE ${plan.guard}`, event.webhookEventId, event.source.userId, enabled ? 'monitor_on' : 'monitor_off', event.webhookEventId);
  return plan.commit(enabled ? '本群組已訂閱 Funbox 新品通知。每 5 分鐘檢查；首次建立基準，不推播既有商品。通知代表分類首次發現，並非保證可購買。' : '本群組已停止新品通知並取消待送訊息；已在傳送中的訊息可能仍會送達。');
}

async function catalog() {
  const products = new Map();
  for (let page = 1; page <= 20; page++) {
    const response = await fetch(`https://shop.funbox.com.tw/category_products/XI/KB.json?limit=18&page=${page}&sort_by=sell_from-desc`, {
      headers: { Accept: 'application/json', 'User-Agent': 'kai981-km-bot-monitor/1.0' }, signal: AbortSignal.timeout(15000)
    }).catch(() => { throw new Error('SOURCE_NETWORK_ERROR'); });
    if (!response.ok) throw new Error('SOURCE_HTTP_ERROR');
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
      products.set(String(row.id), { id: String(row.id), title: row.title.trim(), url: url.href });
    }
    if (rows.length < 18) {
      // 空分類也可能代表來源異常；不將它當成成功的首次基準。
      if (!products.size) throw new Error('SOURCE_EMPTY');
      return [...products.values()];
    }
  }
  throw new Error('SOURCE_PAGE_LIMIT');
}

async function scan(db, owner) {
  const products = await catalog();
  const queries = [];
  const guard = "EXISTS(SELECT 1 FROM monitor_state WHERE id='funbox' AND lease_owner=? AND lease_until>unixepoch())";
  for (const p of products) {
    // 全部頁面成功才交易提交；首次不建立通知。從未出現的 ID 才算新品。
    queries.push(sql(db, `INSERT INTO monitor_outbox(target_id,product_id,message,retry_key)
      SELECT target_id,?,?,lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))
      FROM monitor_subscriptions WHERE enabled=1 AND ${guard}
      AND EXISTS(SELECT 1 FROM monitor_state WHERE id='funbox' AND initialized=1)
      AND NOT EXISTS(SELECT 1 FROM monitor_products WHERE product_id=?)
      ON CONFLICT(target_id,product_id) DO NOTHING`, p.id, `Funbox 分類發現新商品\n${p.title}\n${p.url}\n首次發現：${new Date().toISOString()}\n來源：${SOURCE}\n價格、庫存及購買條件請以商品頁為準。`, owner, p.id));
    queries.push(sql(db, `INSERT INTO monitor_products(product_id,title,url) SELECT ?,?,? WHERE ${guard}
      ON CONFLICT(product_id) DO UPDATE SET title=excluded.title,url=excluded.url`, p.id, p.title, p.url, owner));
  }
  queries.push(sql(db, `UPDATE monitor_state SET initialized=1,last_success=unixepoch(),last_error=NULL WHERE id='funbox' AND lease_owner=? AND lease_until>unixepoch()`, owner));
  try { await db.batch(queries); }
  catch (error) {
    // 本區僅有公開商品 SQL，不包含 LINE 憑證或收件者值。
    console.error(JSON.stringify({ code: 'MONITOR_DATABASE_ERROR', detail: String(error.message).slice(0, 200) }));
    throw new Error('SOURCE_DATABASE_ERROR');
  }
}

async function deliver(db, env, owner) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN) return;
  // LINE retry key 有效期為 24 小時；23 小時後停止自動重試，以免重複推播。
  await db.prepare("UPDATE monitor_outbox SET status='failed' WHERE status='pending' AND first_attempt<unixepoch()-82800").run();
  const rows = (await db.prepare("SELECT * FROM monitor_outbox WHERE status='pending' ORDER BY id LIMIT 5").all()).results;
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
    try { await scan(db, owner); }
    catch (error) {
      const code = /^SOURCE_[A-Z_]+$/.test(error.message) ? error.message : 'MONITOR_SCAN_FAILED';
      await sql(db, "UPDATE monitor_state SET last_error=? WHERE id='funbox' AND lease_owner=?", code, owner).run();
      console.warn(JSON.stringify({ code }));
    }
    await deliver(db, env, owner);
  } finally {
    await sql(db, "UPDATE monitor_state SET lease_until=0 WHERE id='funbox' AND lease_owner=?", owner).run();
  }
}
