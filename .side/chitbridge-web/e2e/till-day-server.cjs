/* till-day-server.cjs — FX-CT1: THE DAY REPORT MUST NOT CLOSE A DAY THE SERVER DISAGREES WITH
 *
 * Walk 14 Oct (NIGHT-2026-10-13 F3): a counter sold a ₹90 bill; the same counter, opened in a browser whose storage was gone,
 * showed "not closed yet · 0 bills · ₹0.00" and offered Close the day — an EMPTY day closed while the server held the bill.
 *
 * Seeds the stand-in server with that bill, opens the counter with EMPTY storage, and proves:
 *   1. the report says "The server has 1 bill · ₹90.00 …" and Close the day is greyed WITH that line (and refuses if called)
 *   2. "Read the day again" brings the bill back → the two agree, 1 bill · ₹90.00, Close the day is offered
 *   3. the server is asked for THIS counter (?till=)
 *   4. the line down → the report says it could not check, and the close is not held back (offline-first)
 *
 * Run: node e2e/till-day-server.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(64) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  let down = false; const asked = [];
  const seeded = () => ({ days: 2, count: 1, bills: [{
    chit_id: '00000000-0000-4000-8000-000000000090', no: 'C1/26-27/0001', at: new Date().toISOString(), customer: 'Walk-in',
    by: null, till: { id: 'C1', name: 'Counter DHW3' }, total: 90, saved: 0, taxable: 90, tax: 0, kind: 'cash',
    payments: [{ how: 'cash', amount: 90 }], invoice: null,
    lines: [{ name: 'Tea', qty: 2, unit: 'cup', price: 20, net: 40 }, { name: 'Vada', qty: 1, unit: 'pc', price: 50, net: 50 }] }] });
  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url === '/api/till/bills') {
      asked.push(q.url);
      if (down) { r.writeHead(503); return r.end('down'); }
      r.writeHead(200, { 'content-type': 'application/json' }); return r.end(JSON.stringify(seeded()));
    }
    if (url.startsWith('/api/')) { r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{"ok":true}'); }
    const f = path.join(ROOT, decodeURIComponent(url).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();
  /* ⭐ a NEW context is a browser whose storage is gone — no IndexedDB, no localStorage */
  const p = await (await b.newContext({ viewport: { width: 1280, height: 880 } })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(base + '/till.html');
  await p.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });
  await p.evaluate((api) => {
    CloudHost.key = 'demo-key'; CloudHost.api = api; HOST = CloudHost;
    ls.set(tillGivenKey(), 'C1');
    WHO = { id: 'w1', name: 'Bala', kind: 'coassist', since: new Date().toISOString() };
    window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR', pay: [{ id: 'cash', label: 'Cash' }] },
                 at: new Date().toISOString(), items: [], offers: [] };
  }, base);

  const report = async () => {
    await p.evaluate(() => dayClose());
    await p.waitForFunction(() => { var e = document.getElementById('slipdaycheck');
      return e && !e.hidden && e.dataset.state && e.dataset.state !== 'asking'; }, null, { timeout: 15000 });
    return p.evaluate(() => {
      var e = document.getElementById('slipdaycheck'), cb = document.getElementById('slipdayclose');
      return { state: e.dataset.state, text: e.innerText.replace(/\s+/g, ' ').trim(), title: document.getElementById('sliptitle').textContent,
               closeShown: !cb.hidden, closeGrey: cb.disabled, closeWhy: cb.title, mark: dayClosedMark() };
    });
  };

  console.log('\n── an empty device, the server holds the counter\'s ₹90 bill');
  const r1 = await report();
  say('the device alone reads 0 bills', /0 bills/.test(r1.title), r1.title);
  say('the server check says the two differ', r1.state === 'differ', r1.state);
  say('the sentence names the count and the money', /The server has 1 bill · ₹\s?90\.00 from this counter today that this device does not\./.test(r1.text), r1.text);
  say('Close the day is shown, greyed', r1.closeShown && r1.closeGrey, 'shown ' + r1.closeShown + ' · disabled ' + r1.closeGrey);
  say('…with its sentence', /disagree/.test(r1.closeWhy), r1.closeWhy);
  say('the fix is offered on the line', /Read the day again/.test(r1.text), 'found');
  say('the server was asked for THIS counter', asked.some((u) => /[?&]till=C1(&|$)/.test(u)), asked[asked.length - 1] || 'never');
  const forced = await p.evaluate(() => { dayCloseDo(); return dayClosedMark(); });
  say('dayCloseDo() refuses while they differ (no close mark)', !forced, String(!!forced));

  console.log('\n── Read the day again → the two agree');
  await p.click('[data-testid="till-day-reread"]');
  await p.waitForFunction(() => /1 bill/.test(document.getElementById('sliptitle').textContent)
    && document.getElementById('slipdaycheck').dataset.state === 'agree', null, { timeout: 15000 });
  const r2 = await report();
  say('the day now reads 1 bill · ₹90.00', /1 bill · ₹\s?90\.00/.test(r2.title), r2.title);
  say('the server check agrees', r2.state === 'agree', r2.text);
  say('Close the day is offered, not greyed', r2.closeShown && !r2.closeGrey, 'disabled ' + r2.closeGrey);
  const stored = await p.evaluate(async () => { var q = (await DB.all('queue')) || [], bl = (await DB.all('bills')) || [];
    return { queued: q.length, sent: bl.every(function(x){ return x._sent && x._sent.chit_id && x._verified; }) }; });
  say('the bill read back is never queued to send again', stored.queued === 0 && stored.sent, JSON.stringify(stored));

  console.log('\n── the line down → said, and the close is not held back');
  down = true;
  const r3 = await report();
  say('the report says it could not check', r3.state === 'offline' && /Could not check/.test(r3.text), r3.text);
  say('Close the day is not greyed offline', r3.closeShown && !r3.closeGrey, 'disabled ' + r3.closeGrey);
  down = false;
  await p.click('[data-testid="till-day-close-do"]');
  const closed = await p.evaluate(() => dayClosedMark());
  say('Close the day closes the agreeing day: 1 bill · ₹90', !!closed && closed.bills === 1 && closed.total === 90, JSON.stringify(closed));

  say('no page errors', errs.length === 0, errs[0] || 'none');
  await b.close(); srv.close();
  console.log('\n' + (bad ? bad + ' FAILED' : 'all passed'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
