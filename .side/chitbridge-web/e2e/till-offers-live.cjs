/* till-offers-live.cjs - A LIVE OFFER REACHES THE NEXT BILL, NEVER THE OPEN ONE (CTR-157, R45 of the 24 Oct walk)
 *
 * The walk: "Make live: on the very next bill" was not true, the counter kept the offers it read until F4. The shop now rings the bell
 * on a saved definition (api routes/definitions.js); the counter must (1) read at once between bills, (2) never change a bill in hand,
 * saying "1 new offer, re-read" on the bar and applying it at the next bill, (3) keep the last list, silently, with the line down.
 *
 * The real till.html, a stand-in shop that serves the snapshot and a real event stream (the bell), and pushes 'shop' events on demand.
 * Run: node e2e/till-offers-live.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const SI = require('./lib/signin.cjs');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
            '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(76) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

const DOSA = { item_id: 'dosa', id: 'dosa', name: 'DOSA', price: 80, unit: 'nos', code: 'DOSA1', category: 'tiffin' };
const TEA = { item_id: 'tea', id: 'tea', name: 'TEA', price: 100, unit: 'nos', code: 'TEA1', category: 'drinks' };
const COFFEE = { item_id: 'coffee', id: 'coffee', name: 'COFFEE', price: 40, unit: 'nos', code: 'COF1', category: 'drinks' };
const offer = (id, item, percent) => ({ id, kind: 'percent_off', label: percent + '% off ' + item, percent, applies_to: { item_ids: [item] } });

(async () => {
  let OFFERS = [];
  const conns = [];
  const srv = http.createServer(async (q, r) => {
    const u = q.url.split('?')[0];
    let raw = ''; for await (const c of q) raw += c;
    const json = (o) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify(o)); };
    if (u === '/push-shop') { conns.forEach((c) => { try { c.write('event: cb\ndata: {"kind":"shop"}\n\n'); } catch (_) { /* a closed stream */ } }); return json({ ok: true }); }
    if (u === '/set-offers') { OFFERS = JSON.parse(raw || '[]'); return json({ ok: true }); }
    if (u === '/api/events/ticket') return json({ ticket: 't' });
    if (u === '/api/events/stream') {
      r.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      r.write('event: hello\ndata: {}\n\n'); conns.push(r);
      q.on('close', () => { const i = conns.indexOf(r); if (i >= 0) conns.splice(i, 1); });
      return;
    }
    if (u === '/api/till/snapshot') return json({ at: '2026-10-31T09:00:00.000Z', entity_id: 'ent-x', shop: { country: 'IN', name: 'Shop X', currency: 'INR' },
      till: { suggested_id: 'C1', assigned_id: 'C1' }, items: [DOSA, COFFEE, TEA], offers: OFFERS, slabs: [], categories: [], version: 'v' + OFFERS.length });
    if (u === '/api/entities/register' || u === '/api/signin/ask') return json({ message: 'sent', dev_otp: '123456' });
    if (u === '/api/entities/verify' || u === '/api/signin/verify') return json({ token: 'T', identity: { identity_id: 'p-x', user_id: 'xclerk', display_name: 'X Clerk', identity_type: 'actor', entity_id: 'ent-x' } });
    if (u.startsWith('/api/')) return json({ ok: true });
    const f = path.join(ROOT, decodeURIComponent(u).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const post = (url, body) => fetch(base + url, { method: 'POST', body: body ? JSON.stringify(body) : '' });

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((a) => {
    if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    localStorage.setItem('cb_till_api', a); localStorage.setItem('cb_till_key', 'KEY-X');
  }, base);
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => { errs.push(String(e)); console.log('PAGEERR', String(e).slice(0,300)); });
  p.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0,200)); }); await p.goto(base + '/till.html');
  await p.waitForFunction(() => typeof refresh === 'function' && typeof bellUp === 'function', null, { timeout: 30000 });
  await p.evaluate(() => refresh().catch(function () {}));
  await p.waitForFunction(() => S && S.shop && S.shop.name === 'Shop X' && (S.items || []).length === 3, null, { timeout: 30000 });
  await SI.signIn(p, 'xclerk'); await SI.signedIn(p);
  await p.evaluate(() => usignClose());
  await p.evaluate(async () => { BELL_AT = 0; await bellUp(); });
  await p.waitForFunction(() => !!BELL && BELL.readyState === 1, null, { timeout: 10000 });
  const offersNow = () => p.evaluate(() => (S.offers || []).map((o) => o.id));
  const pill = () => p.evaluate(() => { const e = document.getElementById('offerpill'); return e && !e.hidden ? e.textContent : ''; });
  const total = () => p.evaluate(() => ((document.querySelector('[data-testid="till-total"]') || {}).textContent || '').replace(/s+/g, ' ').trim());
  const addDosa = async () => { await p.fill('#q', 'DOSA'); await p.waitForSelector('[data-testid="till-add-0"]', { timeout: 20000 }); await p.click('[data-testid="till-add-0"]'); };

  console.log('\n-- 1 - between bills: a live offer is read at once, and prices the next bill --');
  await post('/set-offers', [offer('o1', 'dosa', 10)]); await post('/push-shop');
  await p.waitForFunction(() => (S.offers || []).length === 1, null, { timeout: 15000 }).catch(() => {});
  say('the counter holds the new offer with no F4', JSON.stringify(await offersNow()) === '["o1"]', JSON.stringify(await offersNow()));
  await addDosa();
  say('the next bill takes it off: dosa 80.00 becomes 72.00', /72\.00/.test(await total()), await total());

  console.log('\n-- 2 - a bill in hand: unchanged, the bar says so, the next bill gets it --');
  const before = await total();
  await post('/set-offers', [offer('o1', 'dosa', 10), offer('o2', 'coffee', 20)]); await post('/push-shop');
  await p.waitForFunction(() => { const e = document.getElementById('offerpill'); return e && !e.hidden; }, null, { timeout: 15000 }).catch(() => {});
  const said = await pill();
  say('the bar says "1 new offer, re-read"', /1 new offer, re-read/.test(said), JSON.stringify(said));
  say('the open bill kept the offers it started with', JSON.stringify(await offersNow()) === '["o1"]', JSON.stringify(await offersNow()));
  say('and its total did not move', before !== '' && (await total()) === before, before + ' -> ' + (await total()));
  await p.evaluate(() => clearBill());
  await p.waitForFunction(() => (S.offers || []).length === 2, null, { timeout: 15000 }).catch(() => {});
  say('the next bill starts with both offers', JSON.stringify(await offersNow()) === '["o1","o2"]', JSON.stringify(await offersNow()));
  say('and the bar notice is gone', (await pill()) === '', JSON.stringify(await pill()));
  await p.fill('#q', 'COFFEE'); await p.waitForSelector('[data-testid="till-add-0"]', { timeout: 20000 }); await p.click('[data-testid="till-add-0"]');
  say('the new offer prices that bill: coffee 40.00 becomes 32.00', /32\.00/.test(await total()), await total());
  await p.evaluate(() => clearBill());

  console.log('\n-- 3 - the line is down: the last list stays, nothing new is said --');
  await addDosa();
  await post('/set-offers', [offer('o3', 'dosa', 50)]);
  await ctx.setOffline(true);
  await p.evaluate(() => { window.dispatchEvent(new Event('offline')); });
  await p.evaluate(() => shopHeard());
  await p.waitForTimeout(500);
  say('no notice on the bar', (await pill()) === '', JSON.stringify(await pill()));
  say('the last list is kept', JSON.stringify(await offersNow()) === '["o1","o2"]', JSON.stringify(await offersNow()));
  await p.evaluate(() => clearBill());
  await p.waitForTimeout(500);
  say('clearing the bill offline reads nothing and breaks nothing', JSON.stringify(await offersNow()) === '["o1","o2"]', JSON.stringify(await offersNow()));
  await ctx.setOffline(false);

  console.log('\n-- 4- the pill ASKS before it touches the open bill (money promise: names its reach) --');
  const addTea = async () => { await p.fill('#q', 'TEA'); await p.waitForSelector('[data-testid="till-add-0"]', { timeout: 20000 }); await p.click('[data-testid="till-add-0"]'); };
  const setShop = async (offers) => { await post('/set-offers', offers); await post('/push-shop'); };
  const pillUp = () => p.waitForFunction(() => { const e = document.getElementById('offerpill'); return e && !e.hidden; }, null, { timeout: 15000 });
  const dlg = () => p.evaluate(() => { const d = document.getElementById('askdlg'); return d && d.open ? d.innerText.replace(/\s+/g, ' ').trim() : ''; });
  const teaOffer = offer('t10', 'tea', 10);
  await setShop([]); await p.waitForFunction(() => (S.offers || []).length === 0, null, { timeout: 15000 });
  await addTea(); await addTea();
  say('open bill: 2 x 100.00 totals 200.00', /200.00/.test(await total()), await total());
  await setShop([teaOffer]); await pillUp(); await p.click('#offerpill');
  await p.waitForSelector('#askdlg[open]', { timeout: 10000 });
  const asked = await dlg();
  say('the popup says 200.00 -> 180.00 and this bill only', /200.00 → .*180.00/.test(asked) && /this bill only/.test(asked), JSON.stringify(asked));
  await p.screenshot({ path: process.env.CB_SHOT || 'till-offers-popup.png' });
  await p.click('#askno');
  say('Keep: the open bill still totals 200.00', /200.00/.test(await total()), await total());
  await addTea();
  say('Keep, then a line added: 3 x 100.00 still uses the OLD offers (300.00)', /300.00/.test(await total()), await total());
  say('the bill still holds the old list', (await offersNow()).length === 0, JSON.stringify(await offersNow()));
  await p.evaluate(() => clearBill());
  await p.waitForFunction(() => (S.offers || []).length === 1, null, { timeout: 15000 });
  await addTea();
  say('the NEXT bill gets 10% off: 100.00 becomes 90.00', /90.00/.test(await total()), await total());
  await p.evaluate(() => clearBill());
  await setShop([]); await p.waitForFunction(() => (S.offers || []).length === 0, null, { timeout: 15000 });
  await addTea(); await addTea();
  await setShop([teaOffer]); await pillUp(); await p.click('#offerpill');
  await p.waitForSelector('#askdlg[open]', { timeout: 10000 });
  await p.click('#askok');
  await p.waitForFunction(() => (S.offers || []).length === 1, null, { timeout: 15000 });
  say('Use new prices: the open bill re-prices to 180.00', /180.00/.test(await total()), await total());
  await p.evaluate(() => clearBill());
  await setShop([]); await p.waitForFunction(() => (S.offers || []).length === 0, null, { timeout: 15000 });
  await addTea();
  await setShop([offer('c20', 'coffee', 20)]); await pillUp(); await p.click('#offerpill');
  await p.waitForTimeout(500);
  say('a change that does not move the total: no popup', (await dlg()) === '', JSON.stringify(await dlg()));
  say('the bar says the total is unchanged', /total is unchanged/.test(await p.evaluate(() => document.getElementById('lastnote').textContent)), 'lastnote');
  await p.evaluate(() => clearBill());
  await p.waitForFunction(() => (S.offers || []).length === 1, null, { timeout: 15000 });
  say('and the next bill still reads them', JSON.stringify(await offersNow()) === '["c20"]', JSON.stringify(await offersNow()));

  say('no page error', errs.length === 0, errs.join(' | ').slice(0, 120) || 'none');
  await b.close(); srv.close();
  console.log(bad ? '\n' + bad + ' failed' : '\na live offer reaches the next bill and never changes the open one');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
