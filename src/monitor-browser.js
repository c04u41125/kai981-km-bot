import puppeteer from '@cloudflare/puppeteer';

// Read the public catalog in a browser; no login, challenge solving or private data.
export async function browserCatalog(env, catalog) {
  if (!env.G3_BROWSER) throw Error('SOURCE_BROWSER_MISSING');
  let browser, timer;
  try {
    browser = await puppeteer.launch(env.G3_BROWSER);
    timer = setTimeout(() => browser.close().catch(() => {}), 30000);
    const page = await browser.newPage();
    return await catalog(async url => {
      const response = await page.goto(url, {waitUntil:'domcontentloaded',timeout:20000});
      if (!response) throw Error('SOURCE_BROWSER_EMPTY_RESPONSE');
      return {ok:response.ok(), status:response.status(), url:response.url(),
        headers:new Headers(response.headers()), text:()=>response.text()};
    });
  } catch(error) {
    if (/^SOURCE_[A-Z_0-9]+$/.test(error.message)) throw error;
    console.warn(JSON.stringify({code:'MONITOR_BROWSER_ERROR',detail:String(error.message).slice(0,300)}));
    throw Error('SOURCE_BROWSER_UNAVAILABLE');
  } finally {
    clearTimeout(timer);
    if (browser) await browser.close().catch(()=>{});
  }
}
