const config = window.KM_CONFIG;
const log = document.querySelector('#chat-log');
const form = document.querySelector('#query-form');
const input = document.querySelector('#question');
const connection = document.querySelector('#connection');
let busy = false;

async function api(path) {
  if (!config.API_BASE_URL) throw new Error('API not configured');
  const response = await fetch(`${config.API_BASE_URL.replace(/\/$/, '')}${path}`, { signal: AbortSignal.timeout(10000), credentials: 'omit' });
  if (!response.ok) throw new Error('API unavailable');
  return response.json();
}
function message(text, type) {
  const el = document.createElement('div');
  el.className = `message ${type}`;
  el.textContent = text;
  log.append(el);
  log.scrollTop = log.scrollHeight;
}
async function ask(question) {
  if (busy || !question.trim()) return;
  busy = true;
  form.querySelector('button').disabled = true;
  document.querySelectorAll('[data-question]').forEach(el => { el.disabled = true; });
  message(question, 'user'); input.value = '';
  connection.textContent = '正在查詢…';
  try {
    const result = await api(`/api/knowledge?q=${encodeURIComponent(question)}`);
    message(result.text, 'bot');
    connection.textContent = '已連接共用知識庫';
  } catch {
    message(config.API_BASE_URL ? '目前無法連接知識庫，請稍後再試。這不代表資料庫沒有答案。' : '網站已開啟，但共用知識庫後端尚未設定。完成 Worker 串接後即可查詢。', 'bot');
    connection.textContent = '連線暫時中斷';
  } finally {
    busy = false;
    form.querySelector('button').disabled = false;
    document.querySelectorAll('[data-question]').forEach(el => { el.disabled = false; });
  }
}
form.addEventListener('submit', event => { event.preventDefault(); ask(input.value.trim()); });
document.querySelectorAll('[data-question]').forEach(el => el.addEventListener('click', () => ask(el.dataset.question)));

const list = document.querySelector('#activity-list');
const refresh = document.querySelector('#refresh');
function textElement(tag, text, className) {
  const el = document.createElement(tag); el.textContent = text;
  if (className) el.className = className;
  return el;
}
async function loadActivities() {
  refresh.disabled = true;
  list.replaceChildren(textElement('p', '正在讀取活動…', 'empty'));
  try {
    const result = await api('/api/activities');
    list.replaceChildren();
    if (!result.activities.length) list.append(textElement('p', '目前沒有已確認資料：尚未建立活動。', 'empty'));
    for (const a of result.activities) {
      const card = document.createElement('article'); card.className = 'activity-card';
      const open = a.status === 'open' && Date.parse(a.starts_at) > Date.now();
      card.append(textElement('span', open ? '報名開放中' : a.status === 'closed' ? '報名已關閉' : '已達活動時間', 'status'));
      card.append(textElement('h3', a.title));
      card.append(textElement('p', `時間：${a.starts_at}\n地點：${a.location}\n名額：${a.capacity}｜正取 ${a.confirmed}｜候補 ${a.waitlisted}`));
      card.append(textElement('small', `活動 ID：${a.id}\n來源：${a.source}`));
      list.append(card);
    }
  } catch { list.replaceChildren(textElement('p', config.API_BASE_URL ? '活動資料暫時無法讀取，請確認連線後重新整理。' : '活動後端尚未設定，暫時無法查詢或報名。', 'empty')); }
  finally { refresh.disabled = false; }
}
refresh.addEventListener('click', loadActivities);
if (config.LINE_ADD_FRIEND_URL) {
  try {
    const url = new URL(config.LINE_ADD_FRIEND_URL);
    if (url.protocol === 'https:' && ['line.me','lin.ee'].includes(url.hostname)) {
      const link = document.querySelector('#line-link');
      link.href = url.href; link.hidden = false; link.target = '_blank'; link.rel = 'noopener noreferrer';
      document.querySelector('#line-unconfigured').hidden = true;
    }
  } catch { /* 無效網址維持未設定狀態。 */ }
}
api('/api/knowledge?q=' + encodeURIComponent('品牌資料')).then(() => { connection.textContent = '已連接共用知識庫'; }).catch(() => { connection.textContent = config.API_BASE_URL ? '尚未連接，請確認 Worker 設定' : '後端尚未設定'; });
loadActivities();
