import puppeteer from '@cloudflare/puppeteer';

const FEED = 'https://www.facebook.com/Beyblade2016/';
const MESSAGE = '[data-ad-preview="message"], [data-ad-comet-preview="message"]';
const names = ['Funbox', 'B4合作據點', '夾子園'];

function sheetId(href) {
  try {
    let url = new URL(href);
    if (url.hostname === 'l.facebook.com' && url.pathname === '/l.php') url = new URL(url.searchParams.get('u'));
    if (url.protocol !== 'https:' || url.hostname !== 'docs.google.com') return null;
    return url.pathname.match(/^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})(?:\/|$)/)?.[1] || null;
  } catch { return null; }
}

// Never execute post content or follow arbitrary URLs from it. Only three Google sheet IDs
// from an official-page post's message are accepted, and the caller validates every CSV.
function announcement(message, url, now) {
  const title = message.text.normalize('NFKC').match(/G3[^\n]{0,30}?(20\d{2})\s*(\d{1,2})\s*[~～–-]\s*(\d{1,2})\s*月/);
  if (!title) return null;
  const year = +title[1], first = +title[2], last = +title[3];
  const today = new Date(now + 8*3600000);
  const distance = year*12 + first - (today.getUTCFullYear()*12 + today.getUTCMonth()+1);
  if (first < 1 || first > 11 || first % 2 !== 1 || last !== first+1 || distance < -2 || distance > 3) return null;
  const ids = [...new Set(message.links.map(sheetId).filter(Boolean))];
  if (ids.length !== 3 || !/Funbox/i.test(message.text) || !message.text.includes('B4') || !message.text.includes('夾子園')) throw Error('G3_DISCOVERY_LINKS_CHANGED');
  return { year, first, url, sources: ids.map((id,i) => ({id,name:names[i],year,first})) };
}

async function dismissLogin(page) {
  // Only dismiss an optional login popup; never enter credentials or bypass a challenge.
  await page.evaluate(() => {
    const form = document.querySelector('input[type="password"]');
    const dialog = form?.closest('[role="dialog"]');
    dialog?.querySelector('[aria-label="關閉"], [aria-label="Close"]')?.click();
  });
}

export async function discoverG3(env, now) {
  if (!env.G3_BROWSER) throw Error('G3_DISCOVERY_BROWSER_MISSING');
  let browser, timer;
  try {
    browser = await puppeteer.launch(env.G3_BROWSER);
    // Bound runtime independently of individual navigations; at most six attempts/day.
    timer = setTimeout(() => { browser.close().catch(() => {}); }, 70000);
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    page.setDefaultNavigationTimeout(15000);
    await page.goto(FEED, {waitUntil:'domcontentloaded'});
    await dismissLogin(page);
    await page.waitForSelector('a[href*="/Beyblade2016/posts/"]', {timeout:15000});
    const candidates = new Map();
    for (let scan=0; scan<4; scan++) {
      const found = await page.evaluate((selector) => {
        const results = [];
        for (const message of document.querySelectorAll(selector)) {
          if (!/G3.*20\d{2}/.test(message.innerText)) continue;
          let root = message;
          for (let depth=0; depth<10 && root; depth++,root=root.parentElement) {
            const links = [...root.querySelectorAll('a[href*="/Beyblade2016/posts/"]')].filter(a => !new URL(a.href).searchParams.has('comment_id'));
            const urls = [...new Set(links.map(a => new URL(a.href).origin+new URL(a.href).pathname))];
            if (urls.length === 1) { results.push({url:urls[0],text:message.innerText}); break; }
            if (urls.length > 1) break;
          }
        }
        return results;
      }, MESSAGE);
      for (const candidate of found) if (/^https:\/\/www\.facebook\.com\/Beyblade2016\/posts\/(?:pfbid[A-Za-z0-9]+|\d+)\/?$/.test(candidate.url)) candidates.set(candidate.url,candidate);

      const before = await page.$$eval('a[href*="/Beyblade2016/posts/"]', links => links.length);
      await page.evaluate(() => window.scrollBy(0,1800));
      try { await page.waitForFunction(n => document.querySelectorAll('a[href*="/Beyblade2016/posts/"]').length>n,{timeout:3000},before); } catch { /* bounded public feed scan */ }
    }
    if (!candidates.size) throw Error('G3_DISCOVERY_NOT_FOUND');
    const announcements = [];
    const periodRank = text => { const m=text.match(/G3[^\n]{0,30}?(20\d{2})\s*(\d{1,2})/); return m ? +m[1]*12 + +m[2] : 0; };
    for (const candidate of [...candidates.values()].sort((a,b)=>periodRank(b.text)-periodRank(a.text)).slice(0,3)) {
      await page.goto(candidate.url,{waitUntil:'domcontentloaded'});
      if (!page.url().startsWith(candidate.url)) throw Error('G3_DISCOVERY_UNAVAILABLE');
      await dismissLogin(page);
      await page.waitForFunction(selector => [...document.querySelectorAll(selector)].some(e => /G3/.test(e.innerText) && e.querySelector('a[href*="docs.google.com"],a[href*="docs.google.com%2F"]')), {timeout:10000}, MESSAGE);
      const messages = await page.$$eval(MESSAGE, elements => elements.map(e => ({text:e.innerText,links:[...e.querySelectorAll('a')].map(a=>a.href)})));
      for (const message of messages) { const result = announcement(message,candidate.url,now); if (result) announcements.push(result); }
      if (announcements.length) break;
    }
    if (!announcements.length) throw Error('G3_DISCOVERY_NOT_FOUND');
    return announcements.sort((a,b) => b.year-a.year || b.first-a.first)[0];
  } catch (error) {
    if (/^G3_DISCOVERY_[A-Z_]+$/.test(error.message)) throw error;
    console.warn('G3 discovery unavailable', String(error.message).slice(0,180));
    throw Error('G3_DISCOVERY_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
    if (browser) await browser.close().catch(() => {});
  }
}

export function discoveryLabel(code) {
  return ({G3_DISCOVERY_BROWSER_MISSING:'雲端瀏覽器未設定',G3_DISCOVERY_NOT_FOUND:'公開貼文範圍未找到雙月公告，不能確認沒有新公告',G3_DISCOVERY_LINKS_CHANGED:'公告連結格式改變，未切換來源',G3_DISCOVERY_UNAVAILABLE:'Facebook 或雲端瀏覽器暫時無法讀取',G3_DISCOVERY_DAILY_LIMIT:'今日公告檢查已達上限，明日再試',G3_DISCOVERY_VALIDATION_FAILED:'新公告表單驗證失敗，保留原來源',G3_DISCOVERY_OLDER:'只讀到較舊公告，保留來源並重試'})[code] || code;
}
