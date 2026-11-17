/**
 * e2e/promo-screen-key.cjs — THE SHOP SCREEN KEEPS ITS OWN KEY, AND CAN BE MADE TO ASK FOR A NEW CODE (2026-09-27).
 *
 * Athi: "when i open the link, it automatically open the link, it is not connected using the pairing key, is there
 * a way to force to use the newer key from the tv". promo.html read and wrote cb_till_key — the COUNTER's storage
 * name — so it opened on the counter's key, never asked for a code, and pairing overwrote the counter's key.
 * Run: node e2e/promo-screen-key.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(62) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url === '/api/till/pair/claim') { r.writeHead(200, { 'content-type': 'application/json' });
      return r.end(JSON.stringify({ key: 'SCREEN-KEY-NEW', shop: { entity_id: 'e1', name: 'Mayur Bhavan' } })); }
    if (url === '/api/till/snapshot') { r.writeHead(200, { 'content-type': 'application/json' });
      return r.end(JSON.stringify({ shop: { name: 'Mayur Bhavan', currency: 'INR' }, items: [{ item_id: 'a', name: 'Idli', price: 40 }], offers: [] })); }
    if (url.startsWith('/api/')) { r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{}'); }
    const f = path.join(ROOT, decodeURIComponent(url).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 760 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  const state = () => p.evaluate(() => ({ pairing: !document.getElementById('pairwrap').hidden,
    till: localStorage.getItem('cb_till_key'), screen: localStorage.getItem('cb_screen_key'), key: window.KEY || null }));

  /* a browser that runs the COUNTER: its key sits in cb_till_key */
  await p.goto(base + '/promo.html');
  await p.evaluate((api) => { localStorage.clear(); localStorage.setItem('cb_till_key', 'COUNTER-KEY'); localStorage.setItem('cb_till_api', api); }, base);

  console.log('\n── a browser that runs the counter no longer opens the sign on the counter key');
  await p.goto(base + '/promo.html'); await p.waitForTimeout(400);
  let st = await state();
  say('it asks this screen for a code', st.pairing === true && !st.key, JSON.stringify(st));

  console.log('\n── pairing keeps the TV key apart from the counter key');
  await p.fill('#paircode', 'KMT4RX'); await p.click('#pairgo');
  await p.waitForFunction(() => localStorage.getItem('cb_screen_key') === 'SCREEN-KEY-NEW', null, { timeout: 5000 });
  await p.waitForTimeout(1200);
  st = await state();
  say('the TV key is kept as cb_screen_key', st.screen === 'SCREEN-KEY-NEW', st.screen);
  say('⭐ the COUNTER key is untouched', st.till === 'COUNTER-KEY', st.till);
  say('after pairing the sign runs on the TV key', st.pairing === false && st.key === 'SCREEN-KEY-NEW', JSON.stringify({ pairing: st.pairing, key: st.key }));

  console.log('\n── #pair forces a fresh code');
  await p.goto(base + '/promo.html#pair'); await p.waitForLoadState('load'); await p.waitForTimeout(700);
  st = await state();
  say('the screen key is forgotten and the code screen shows', st.pairing === true && !st.screen && !st.key, JSON.stringify(st));
  say('and the counter key is STILL untouched', st.till === 'COUNTER-KEY', st.till);

  console.log('\n── the counter "▶ This device" link works for that tab only');
  await p.goto(base + '/promo.html#key=COUNTER-KEY'); await p.waitForLoadState('load'); await p.waitForTimeout(700);
  st = await state();
  say('this tab runs on the key it was handed', st.pairing === false && st.key === 'COUNTER-KEY', JSON.stringify({ pairing: st.pairing, key: st.key }));
  say('and nothing was saved where a TV would keep it', !st.screen, String(st.screen));
  const p2 = await ctx.newPage(); await p2.goto(base + '/promo.html'); await p2.waitForTimeout(400);
  const other = await p2.evaluate(() => ({ pairing: !document.getElementById('pairwrap').hidden, key: window.KEY || null }));
  say('another tab (a TV) still asks for its own code', other.pairing === true && !other.key, JSON.stringify(other));

  say('console/page errors', !errs.length, errs.length ? errs.join(' | ').slice(0, 200) : 'none');
  await b.close(); srv.close();
  console.log(bad ? '\n' + bad + ' FAILED' : '\nthe shop screen keeps its own key and can be made to ask for a new one');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
