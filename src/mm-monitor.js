export const MM_SOURCE = 'https://mmtoyshop.com/category/%F0%9F%8C%80%E6%88%B0%E9%AC%A5%E9%99%80%E8%9E%BA';
const sql = (db, query, ...args) => db.prepare(query).bind(...args);
const guard = "EXISTS(SELECT 1 FROM monitor_state WHERE id='funbox' AND lease_owner=? AND lease_until>unixepoch())";

async function readPage(page) {
  const url = new URL(MM_SOURCE);
  url.searchParams.set('page', String(page));
  const response = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'kai981-km-bot-monitor/1.0', Accept: 'text/html' }, signal: AbortSignal.timeout(12000) });
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) throw new Error('MM_SOURCE_HTTP');
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 4000000) { await reader.cancel(); throw new Error('MM_SOURCE_TOO_LARGE'); }
    chunks.push(value);
  }
  const html = await new Blob(chunks).text();
  const payload = html.match(/<script[^>]+id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!payload) throw new Error('MM_SOURCE_FORMAT');
  const data = JSON.parse(payload[1]);
  if (!Array.isArray(data)) throw new Error('MM_SOURCE_FORMAT');
  // Read pagination references only; never execute third-party scripts.
  const meta = data.find(v => v && !Array.isArray(v) && typeof v === 'object' && 'currentPage' in v && 'products' in v && 'lastPage' in v);
  const current = data[meta?.currentPage], total = data[meta?.total], last = data[meta?.lastPage];
  if (current !== page || !Number.isSafeInteger(total) || total < 1 || total > 500 || !Number.isSafeInteger(last) || last < page || last > 20) throw new Error('MM_SOURCE_PAGINATION');
  const products = []; let card = null;
  const selector = '[data-bv="product-card"]';
  await new HTMLRewriter()
    .on(selector, { element(e) {
      if (card) throw new Error('MM_SOURCE_FORMAT');
      card = { title: e.getAttribute('title'), url: null, price: '', buttons: [] };
      products.push(card); e.onEndTag(() => { card = null; });
    } })
    .on(`${selector} [data-bv="product-card-title"]`, { element(e) { if (card) card.url = e.getAttribute('href'); } })
    .on(`${selector} [data-bv="product-price"]`, { text(t) { if (card) card.price += t.text; } })
    .on(`${selector} button`, { element(e) {
      if (card) card.buttons.push({ text: '', soldoutMarker: e.getAttribute('data-bv') === 'product-soldout', enabled: !e.hasAttribute('disabled') && e.getAttribute('aria-disabled') !== 'true' });
    }, text(t) { if (card?.buttons.length) card.buttons.at(-1).text += t.text; } })
    .transform(new Response(html)).text();
  if (!products.length) throw new Error('MM_SOURCE_EMPTY');
  return { total, last, products: products.map(p => {
    const url = new URL(p.url || '', MM_SOURCE);
    if (url.origin !== 'https://mmtoyshop.com' || !/^\/item\/[a-zA-Z0-9_-]+$/.test(url.pathname) || typeof p.title !== 'string' || !p.title.trim() || p.title.length > 500) throw new Error('MM_SOURCE_FORMAT');
    const buttons = p.buttons.map(b => ({ ...b, text: b.text.trim() }));
    const soldout = buttons.some(b => b.text === '補貨中');
    const buyable = buttons.some(b => b.enabled && ['直接購買', '加入購物車'].includes(b.text));
    if ((soldout && buyable) || (!soldout && !buyable && !buttons.some(b => b.soldoutMarker))) throw new Error('MM_SOURCE_UNKNOWN_STATUS');
    const price = p.price.replace(/\s+/g, '').slice(0, 100);
    return { id: url.pathname.slice(6), url: url.href, title: p.title.trim(), price: price || '未提供', status: soldout ? 'restocking' : buyable ? 'available' : 'unknown' };
  }) };
}

async function catalog() {
  const first = await readPage(1); const all = [...first.products];
  for (let page = 2; page <= first.last; page++) {
    const next = await readPage(page);
    if (next.total !== first.total || next.last !== first.last) throw new Error('MM_SOURCE_PAGINATION');
    all.push(...next.products);
  }
  if (all.length !== first.total || new Set(all.map(p => p.id)).size !== all.length) throw new Error('MM_SOURCE_PAGINATION');
  return all;
}

export async function scanMm(db, owner) {
  try {
    const products = await catalog();
    const scanId = crypto.randomUUID(); const queries = [];
    for (const p of products) {
      // Prior status + cycle provides repeat-restock notifications without duplicate deliveries.
      queries.push(sql(db, `INSERT INTO monitor_outbox(target_id,product_id,message,retry_key)
        SELECT s.target_id,'mm:'||p.product_id||':'||(p.cycle+1),?,lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))
        FROM monitor_subscriptions s CROSS JOIN mm_products p
        WHERE s.enabled=1 AND p.product_id=? AND p.status='restocking' AND ?='available' AND ${guard}
        ON CONFLICT(target_id,product_id) DO NOTHING`, `M.M小舖補貨通知/${p.title}/${p.price}/${p.url}\n補貨中 → 可購買（以商店當下頁面為準）`, p.id, p.status, owner));
      queries.push(sql(db, `INSERT INTO mm_products(product_id,title,url,price,status,scan_id) SELECT ?,?,?,?,?,? WHERE ${guard}
        ON CONFLICT(product_id) DO UPDATE SET title=excluded.title,url=excluded.url,price=excluded.price,
        cycle=mm_products.cycle+CASE WHEN mm_products.status='restocking' AND excluded.status='available' THEN 1 ELSE 0 END,
        status=excluded.status,scan_id=excluded.scan_id`, p.id, p.title, p.url, p.price, p.status, scanId, owner));
    }
    queries.push(sql(db, `UPDATE mm_products SET status='unknown' WHERE scan_id<>? AND ${guard}`, scanId, owner));
    queries.push(sql(db, `UPDATE monitor_state SET initialized=1,last_success=unixepoch(),last_error=NULL WHERE id='mmtoy' AND ${guard}`, owner));
    await db.batch(queries);
  } catch (error) {
    const code = /^MM_SOURCE_[A-Z_]+$/.test(error.message) ? error.message : 'MM_SOURCE_SCAN_FAILED';
    await sql(db, `UPDATE monitor_state SET last_error=? WHERE id='mmtoy' AND ${guard}`, code, owner).run();
    console.warn(JSON.stringify({ code }));
  }
}

export async function mmStatus(db) {
  const state = await db.prepare("SELECT initialized,last_success,last_error FROM monitor_state WHERE id='mmtoy'").first();
  const count = await db.prepare("SELECT COUNT(*) AS count, SUM(CASE WHEN status='unknown' THEN 1 ELSE 0 END) AS unknown_count FROM mm_products").first();
  return { source: MM_SOURCE, interval_minutes: 1, ...state, known_products: count.count, unknown_products: count.unknown_count || 0 };
}
