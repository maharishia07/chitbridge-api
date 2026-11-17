/* folders-offline.cjs (MNT-59, pin leg iv) — the service worker holds every file of the Folders capability and the app still opens it with no network.
 * OWNS      with the service worker ALLOWED: the shell cache (cb-shell-<CB_SW_VERSION>) lists every public/app/cap-folders*.js; after one online ensureCap('folders') the browser goes
 *           offline, reloads app.html, and ensureCap('folders') resolves with every name still a function.
 * CALLED BY e2e/run-shard.cjs (EXTRA) · the move-only PR of the folders split.
 * FLOW      serve public/ ──▶ app.html signed in, SW active ──▶ cache.keys() ──▶ ensureCap online ──▶ setOffline ──▶ reload ──▶ ensureCap + typeof every name.
 * RED when one cap-folders file is dropped from PRECACHE (the cache check) or a part is not in CAP_WITH (the offline ensureCap check).
 * Note (found while writing it): the loader asks for /app/cap-x.js?v=CB_BUILD and the worker answers by exact URL, so a precached file serves offline only through the copy the page itself put
 * after one online load; the precache list is the install-time guarantee, the online load is what makes the offline open work. */
'use strict';
const fs = require('fs'), path = require('path');
const { chromium } = require('@playwright/test');
const { server, signedContext, counters, names } = require('./folders-pin-lib.cjs');
const { ok, finish } = counters();
const family = fs.readdirSync(path.join(__dirname, '..', 'public', 'app')).filter((file) => /^cap-folders(-[a-z]+)?\.js$/.test(file));

(async () => {
  const srv = await server(), browser = await chromium.launch(), S = { calls: [], writes: [] }, threw = [];
  const ctx = await signedContext(browser, S, 'allow');
  const page = await ctx.newPage();
  page.on('pageerror', (error) => threw.push(error.message));
  /* a bare same-origin file registers the worker, so nothing but its own PRECACHE can fill the cache (app.html would load cap-folders.js itself) */
  await page.goto(srv.base + '/app/manifest.json');
  await page.evaluate(() => navigator.serviceWorker.register('/cb-sw.js').then(() => navigator.serviceWorker.ready));
  const cached = await page.evaluate(async () => {
    for (let tries = 0; tries < 40; tries++) {
      const keys = (await caches.keys()).filter((key) => key.startsWith('cb-shell-'));
      const urls = keys.length ? (await (await caches.open(keys[0])).keys()).map((req) => new URL(req.url).pathname) : [];
      if (urls.some((url) => url === '/app/cap-folders.js')) return urls;
      await new Promise((done) => setTimeout(done, 250));
    }
    return [];
  });
  const missing = family.filter((file) => cached.indexOf('/app/' + file) < 0);
  ok(cached.length > 0 && missing.length === 0, 'the shell cache holds every Folders file (' + family.join(', ') + ')' + (missing.length ? ' — missing: ' + missing.join(', ') : ''));

  /* load the app under the worker's control so it sees (and keeps) every file the shell asks for */
  await page.goto(srv.base + '/app.html#/app');
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('[data-testid="nav-task"]', { timeout: 20000 });
  const online = await page.evaluate(() => ensureCap('folders').then(() => 'loaded', (error) => 'failed: ' + error.message));
  ok(online === 'loaded', 'online: ensureCap(\'folders\') resolves (' + online + ')');
  await page.waitForTimeout(500);

  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof ensureCap === 'function', null, { timeout: 20000 }).catch(() => {});
  const shell = await page.evaluate(() => typeof ensureCap);
  ok(shell === 'function', 'offline: app.html reloads from the service worker and the shell runs');
  const offline = await page.evaluate(() => ensureCap('folders').then(() => 'loaded', (error) => 'failed: ' + error.message));
  ok(offline === 'loaded', 'offline: ensureCap(\'folders\') resolves from the cache (' + offline + ')');
  const types = await page.evaluate((list) => list.filter((name) => typeof window[name] === 'undefined'), names());
  ok(types.length === 0, 'offline: all ' + names().length + ' Folders names exist' + (types.length ? ' — missing: ' + types.slice(0, 6).join(', ') : ''));
  ok(!threw.some((message) => /is not defined|folder|ensureCap/i.test(message)), 'no ReferenceError from the folder code' + (threw.length ? ' — ' + threw[0].slice(0, 100) : ''));
  await ctx.close(); await browser.close(); srv.close();
  finish('folders-offline');
})().catch((error) => { console.error(error); process.exit(1); });
