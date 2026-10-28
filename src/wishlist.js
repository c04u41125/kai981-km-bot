import { wishCards, wishCancelConfirmation, wishQuickReply } from './wishlist-ui.js';
const HELP = `戰隊許願板（本群組共用）
・許願 UX-18-01 漢克：登記型號及群內稱呼
・許願板：查看所有需求
・許願板 UX-18-01：找想要這個型號的人
・我的許願：查看自己登記的需求
・取消許願 UX-18-01：取得後取消
多頁時可輸入「許願板 第2頁」或「我的許願 第2頁」。
每筆代表想要 1 顆；稱呼由本人填寫，請用大家認得的名稱。`;

function modelKey(value) {
  const key = value.normalize('NFKC').toUpperCase().replace(/[‐‑–—−]/g, '-');
  const match = key.match(/^([A-Z]{1,8})-?(\d{1,4})(?:-(\d{1,3}))?$/);
  return match ? `${match[1]}-${match[2]}${match[3] ? `-${match[3]}` : ''}` : null;
}

export async function wishlistCommand(db, event, text, p) {
  if (!/^(?:許願|我的許願|取消許願)/.test(text) && !(event.type === 'postback' && /^(新增|查詢|確認取消 )/.test(text))) return null;
  const source = event.source;
  const scopeId = source.type === 'group' ? source.groupId : source.type === 'room' ? source.roomId : null;
  if (!scopeId) return p.commit(`請在戰隊群組 @Bot 使用許願板；每個群組的清單獨立。\n\n${HELP}`);
  const scope = `${source.type}:${scopeId}`;
  const user = source.userId;
  const eventId = event.webhookEventId;
  if (text === '新增' || text === '查詢') {
    const hint = text === '新增' ? '請在本群組 @Bot，再輸入：\n許願 UX-18-01 你的群內稱呼\n\n替換成你想要的型號與稱呼即可；每筆為 1 顆。' : '請在本群組 @Bot，再輸入：\n許願板 UX-18-01\n\n替換型號即可找出想要這款的成員。也可以直接點卡片上的「查看此型號需求」。';
    return p.commit(hint, null, [], [{ type: 'text', text: hint, quickReply: wishQuickReply() }]);
  }
  if (text.startsWith('確認取消 ')) return p.commit('請確認是否取消自己的許願。', null, [], wishCancelConfirmation(text.slice(5)));
  const add = text.match(/^許願\s+(\S+)\s+(.+)$/u);
  const cancel = text.match(/^取消許願\s+(\S+)$/u);
  if (add || cancel) {
    if (!user) return p.commit('無法辨識你的 LINE 身分，未修改許願板。請使用自己的 LINE 帳號重新 @Bot。');
    const model = modelKey((add || cancel)[1]);
    if (!model) return p.commit(`型號格式不正確，例如 UX-18-01、BX-01。\n\n${HELP}`);
    if (cancel) {
      const exists = await db.prepare('SELECT id FROM wishlist WHERE scope_key=? AND user_id=? AND model=?').bind(scope, user, model).first();
      if (!exists) return p.commit(`你在本群組沒有 ${model} 的許願紀錄。只能取消自己的許願。`);
      p.add(`DELETE FROM wishlist WHERE scope_key=? AND user_id=? AND model=? AND ${p.guard}`, scope, user, model, eventId);
      return p.commit(`已取消你對 ${model} 的許願。`);
    }
    const name = add[2].trim().normalize('NFKC');
    if (!name || name.length > 30 || /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(name)) return p.commit('群內稱呼請填 1–30 字，不可換行或包含控制字元。例：許願 UX-18-01 漢克');
    p.add(`INSERT INTO wishlist(scope_key,user_id,model,display_name)
      SELECT ?,?,?,? WHERE ${p.guard}
      ON CONFLICT(scope_key,user_id,model) DO UPDATE SET display_name=excluded.display_name`, scope, user, model, name, eventId);
    return p.commit(`已登記：${name}｜${model}｜1 顆\n重複登記不會增加筆數。取得後請輸入「取消許願 ${model}」。\n有多買的成員可用「許願板 ${model}」查詢，自行在群內聯繫。`);
  }
  const query = text.match(/^(許願板|我的許願)(?:\s+(?!第\d+頁$)(\S+))?(?:\s+第(\d+)頁)?$/u);
  if (!query) return p.commit(HELP);
  const mine = query[1] === '我的許願';
  if (mine && !user) return p.commit('無法辨識你的 LINE 身分，請重新 @Bot。');
  const model = query[2] ? modelKey(query[2]) : null;
  if (query[2] && !model) return p.commit(`型號格式不正確。\n\n${HELP}`);
  const page = Number(query[3] || 1);
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000) return p.commit('頁碼請使用 1–10000 的整數，例如「許願板 第2頁」。');
  const where = 'scope_key=?' + (mine ? ' AND user_id=?' : '') + (model ? ' AND model=?' : '');
  const args = [scope, ...(mine ? [user] : []), ...(model ? [model] : [])];
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM wishlist WHERE ${where}`).bind(...args).first()).n;
  if (!total) return p.commit('目前沒有符合的許願。', null, [], wishCards([], { mine, model }));
  const pages = Math.ceil(total / 25);
  if (page > pages) return p.commit(`目前共 ${pages} 頁。請輸入「${query[1]}${model ? ` ${model}` : ''} 第${pages}頁」。`);
  const rows = (await db.prepare(`SELECT model,display_name FROM wishlist WHERE ${where} ORDER BY model,id LIMIT 25 OFFSET ?`).bind(...args, (page - 1) * 25).all()).results;
  return p.commit(`許願板：${total} 筆需求，第 ${page}/${pages} 頁。`, null, [], wishCards(rows, { mine, model, total, page, pages }));
}
