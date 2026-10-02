// Read public data only. Never evaluate third-party JavaScript or load paid features.
const SOURCE = 'https://ddtank98776.github.io/beyblade/';
const CACHE_KEY = 'https://kai981-km-bot.workers.dev/internal-cache/market-v1';
const TTL = 30 * 60 * 1000;
let pending;

function jsonVariable(html, name) {
  const marker = new RegExp('\\bvar\\s+' + name + '\\s*=\\s*').exec(html);
  if (!marker) throw new Error('MARKET_SCHEMA');
  const start = marker.index + marker[0].length;
  if (html[start] !== '{') throw new Error('MARKET_SCHEMA');
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(html.slice(start, i + 1));
  }
  throw new Error('MARKET_SCHEMA');
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[half] : Math.round((sorted[half - 1] + sorted[half]) / 2);
}

function summarize(rows) {
  if (!rows.length) return { price: null, count: 0, days: 0 };
  if (rows.length >= 5) {
    const center = median(rows.map(r => r[2]));
    rows = rows.filter(r => r[2] >= center * 0.4 && r[2] <= center * 2.5);
  }
  let selected = rows, days = 0;
  for (const window of [14, 30, 90]) {
    const recent = rows.filter(r => r[1] <= window);
    if (recent.length >= 8) { selected = recent; days = window; break; }
  }
  return { price: selected.length ? median(selected.map(r => r[2])) : null, count: selected.length, days };
}

function fresh(date) {
  const timestamp = Date.parse(date + 'T00:00:00+08:00');
  const age = Date.now() - timestamp;
  return Number.isFinite(timestamp) && age >= -86400000 && age <= 7 * 86400000;
}

async function loadSnapshot() {
  const cached = await caches.default.match(CACHE_KEY);
  if (cached) {
    const snapshot = await cached.json();
    if (Date.now() - snapshot.fetchedAt < TTL && fresh(snapshot.date)) return snapshot;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let html;
  try {
    const response = await fetch(SOURCE, { signal: controller.signal, redirect: 'error' });
    if (!response.ok || !response.body) throw new Error('MARKET_FETCH');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    html = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 12 * 1024 * 1024) { await reader.cancel(); throw new Error('MARKET_SIZE'); }
      html += decoder.decode(value, { stream: true });
    }
    html += decoder.decode();
  } finally { clearTimeout(timeout); }
  // Fail closed if the upstream row status/category encoding changes.
  if (!/var SN\s*=\s*\['成交','在售','收購','競標'\]/.test(html) ||
      !/KN\s*=\s*\['整顆','零件','組合','拆賣'\]/.test(html) ||
      !/var VN\s*=\s*\['','日版','台版','亞版','美版'/.test(html)) throw new Error('MARKET_SCHEMA');
  const date = html.match(/資料更新：<\/span>\s*(\d{4}-\d{2}-\d{2})/)?.[1];
  if (!date || !fresh(date)) throw new Error('MARKET_STALE');
  const data = jsonVariable(html, 'D');
  const catalog = jsonVariable(html, 'CAT');
  if (!Array.isArray(data.m) || !Array.isArray(data.n) || !Array.isArray(data.r) ||
      !catalog.sku || data.m.length > 10000 || data.r.length > 200000) throw new Error('MARKET_SCHEMA');
  const groups = new Map();
  for (const r of data.r) {
    if (!Array.isArray(r) || !Number.isInteger(r[0]) || r[0] < 0 || r[0] >= data.m.length ||
        !Number.isFinite(r[1]) || r[1] < 0 || !Number.isFinite(r[2]) || r[2] <= 0 ||
        r[3] !== 0 || r[5] !== 0 || !Number.isInteger(r[6]) || r[6] < 0 || r[6] > 7 || r[6] === 4) continue;
    if (!groups.has(r[0])) groups.set(r[0], []);
    groups.get(r[0]).push(r);
  }
  const items = data.m.map((key, i) => {
    if (typeof key !== 'string' || key.length > 100) throw new Error('MARKET_SCHEMA');
    const [sku, variant] = key.split('·');
    const name = variant || catalog.sku[sku]?.[0] || data.n[i]?.[0];
    return { key, sku, name: typeof name === 'string' ? name.slice(0, 100) : '目前沒有已確認中文名稱', ...summarize(groups.get(i) || []) };
  });
  const snapshot = { fetchedAt: Date.now(), date, items };
  await caches.default.put(CACHE_KEY, Response.json(snapshot, { headers: { 'Cache-Control': 'public, max-age=1800' } }));
  return snapshot;
}

export async function marketReply(text) {
  const normalized = text.normalize('NFKC').trim();
  if (!/行情$/.test(normalized)) return null;
  const query = normalized.slice(0, -2).trim().replace(/^[「『"]|[」』"]$/g, '');
  const match = query.match(/^(BXG|BXH|BXA|BXC|BX|CX|UX)[\s－-]*(\d{1,3})(?:[\s－-]+(\d{1,2}))?(?:[\s·]+(.{1,60}))?$/i);
  if (!match) return '查行情請輸入：型號行情\n例如：UX-01行情、BX-35-01行情。';
  const sku = `${match[1].toUpperCase()}-${match[2].padStart(2, '0')}${match[3] ? '-' + match[3].padStart(2, '0') : ''}`;
  try {
    pending ||= loadSnapshot().finally(() => { pending = null; });
    const snapshot = await pending;
    let choices = snapshot.items.filter(item => item.sku === sku);
    if (match[4]) choices = choices.filter(item => item.key.split('·')[1] === match[4] || item.name === match[4]);
    if (choices.length > 1 || (/-00$/.test(sku) && !match[4])) {
      const variants = choices.filter(item => item.key.includes('·'));
      return `${sku} 有多個款式，請補上款名，例如「${variants[0]?.key.replace('·', ' ') || sku + ' 款名'}行情」。\n${variants.slice(0, 12).map(item => item.key.replace('·', ' ')).join('\n')}\n完整款式與來源：${SOURCE}`;
    }
    const item = choices[0];
    if (!item) return `${sku}\n目前沒有已確認資料：查無此型號或款式。\n來源：${SOURCE}`;
    const price = item.price === null ? '目前沒有已確認資料（無可用成交紀錄）' : `NT$${item.price.toLocaleString('en-US')}`;
    const basis = item.count ? `\n${item.days ? '近' + item.days + '天' : '全部期間'}成交 ${item.count} 筆${item.count < 5 ? '（樣本較少）' : ''}；整顆、不含美版` : '';
    return `${item.sku}\n${item.name}\n成交中位數：${price}${basis}\n資料日期：${snapshot.date}\n來源：${SOURCE}`;
  } catch {
    return `${sku}\n目前沒有已確認資料：行情來源暫時無法讀取、格式變更或資料已逾 7 天，請稍後再查。\n來源：${SOURCE}`;
  }
}
