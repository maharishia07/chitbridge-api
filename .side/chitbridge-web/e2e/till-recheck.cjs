/* till-recheck.cjs — CTR-212 S2a: THE COUNTER READS PRICES AGAIN BEFORE A BILL IS FINISHED, AND SHOWS WHAT MOVED
 *
 * Athi's hole: a bill parked while the price (or the rate, or the product) moved was finished at the old figures with nothing said.
 * Drives the REAL till page and its REAL popup (askdlg): the cart is rung, the catalogue door (POST /api/till/recheck) answers what the
 * shop says NOW, and the page's own engine prices the bill once. HAND figures (typed here, the engine is only read):
 *   2 x 100.00 excl at 18% intra = 200.00 + 18.00 + 18.00 = 236.00; price 120 = 240.00 + 21.60 + 21.60 = 283.20; rate 12 = 200.00 + 12.00 + 12.00 = 224.00.
 * Proves, through the screen: the popup says 236.00 → 283.20 and "Use new prices" makes the bill 283.20 · a rate move has no Keep (the cancel
 * button reads Go back) and 224.00 is what it says · a product the shop deleted offers only Remove or Go back and, removed, is not on the bill ·
 * Keep as quoted (price only) asks the owner and leaves 236.00 · a unit moved (piece → kg) shows the line, an unchanged unit shows nothing · a check that is not due (answered "off", never parked) never calls the door ·
 * a door that fails never stops the sale (236.00, reason recheck_failed). The popup is the CTR-157 offersReread shape: this bill before → after.
 * UI ids: till-recheck-popup (the askdlg that carries it) · path till.html › finish/unpark › recheckAsk.
 *
 * Run: node e2e/till-recheck.cjs   (on the SIT box sit-in under nohup, never on the laptop)
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let bad = 0;
const say = (label, ok, detail) => { console.log('  ' + String(label).padEnd(62) + '· ' + detail + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url.startsWith('/api/')) { r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{"ok":true}'); }
    const f = path.join(ROOT, decodeURIComponent(url).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((r) => srv.listen(0, r));
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(base + '/till.html');
  await page.waitForFunction(() => typeof window.screenSet === 'function' && typeof window.recheckBeforeBill === 'function', null, { timeout: 30000 });

  /* a counter with one product, 2 of it in the cart, the catalogue door stubbed to answer what the test says */
  const setup = (setting, row) => page.evaluate(({ setting, row }) => {
    CloudHost.key = 'demo-key'; HOST = CloudHost; WHO = { id: 'w1', name: 'Bala', kind: 'coassist', since: new Date().toISOString() };
    window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR', gstin: '33AABCK1234F1Z6', state_code: '33', reg_type: 'regular' }, at: '2026-11-08T05:00:00.000Z', items: [], offers: [], slabs: [], categories: [], face: {},
                 policy: { price_includes_tax: 'no', recheck_prices: setting, park_max_hours: 12 } };
    window.lineUp = () => true;
    window.__posts = 0; window.__owner = 0;
    window.ownerPinAsk = async () => { window.__owner++; return { by: { id: 'owner-1', name: 'Athi' } }; };
    HOST.tillPost = async (p, body) => { window.__posts++; if (row === 'fails') return { ok: false, why: 'ChitBridge answered 500' }; return { ok: true, at: new Date().toISOString(), items: [Object.assign({ item_id: 'A', name: 'Pen', found: true, checked: true, active: true, status: 'available', price: 100, hsn: '9608', gst_rate: 18, stamp: null }, row)], slabs: [], categories: [], face: {} }; };
    CART = []; addItem({ item_id: 'A', name: 'Pen', price: 100, unit: 'piece', hsn: '9608', gst_rate: 18 }, 2); price();
    return billMoney().net;
  }, { setting, row });
  const net = () => page.evaluate(() => { price(); return billMoney().net; });
  const popup = async () => { await page.waitForSelector('#askdlg[open]', { timeout: 20000 }); return page.evaluate(() => ({ text: document.getElementById('askbody').innerText.replace(/\s+/g, ' '), ok: document.getElementById('askok').textContent, no: document.getElementById('askno').textContent })); };
  const start = async () => { await page.waitForSelector('#askdlg:not([open])', { state: 'attached', timeout: 10000 }); await page.evaluate(() => { window.__r = recheckBeforeBill(); }); };
  /* press a button, take the answer, and wait until the dialog is CLOSED so the next case starts from a quiet page */
  const finishWith = async (id) => {
    const answer = await page.evaluate(async (button) => { document.getElementById(button).click(); return JSON.stringify(await window.__r); }, id);
    await page.waitForSelector('#askdlg:not([open])', { state: 'attached', timeout: 10000 });
    return answer;
  };

  console.log('\n── price 100 → 120, the owner said "every bill" ──');
  say('the bill rings 236.00 before the check (hand)', (await setup('on', { price: 120 })) === 236, '236.00');
  await start(); let shown = await popup();
  say('the popup names the move: 236.00 → 283.20, and offers Use new prices / Keep as quoted', /236\.00 → .*283\.20/.test(shown.text) && /Use new prices/.test(shown.ok) && /Keep as quoted/.test(shown.no), shown.text.slice(0, 120));
  await finishWith('askok');
  say('Use new prices: the bill is 283.20 (hand: 240.00 + 21.60 + 21.60)', (await net()) === 283.2, String(await net()));

  console.log('\n── rate 18 → 12: no Keep ──');
  await setup('on', { gst_rate: 12 }); await start(); shown = await popup();
  say('the popup says 236.00 → 224.00 and the cancel button reads Go back (no Keep)', /236\.00 → .*224\.00/.test(shown.text) && /Go back/.test(shown.no) && !/Keep/.test(shown.no), shown.no);
  await finishWith('askno');
  say('Go back leaves the bill as it was (236.00) and asks for no owner', (await net()) === 236 && (await page.evaluate(() => window.__owner)) === 0, '236.00');
  await setup('on', { gst_rate: 12 }); await start(); await popup(); await finishWith('askok');
  say('Use new prices: the bill is 224.00 (hand: 200.00 + 12.00 + 12.00)', (await net()) === 224, String(await net()));

  console.log('\n── unit piece → kg, the price unchanged (CAT-264b: a unit move is a commercial change like price) ──');
  await setup('on', { unit: 'kg' }); await start(); shown = await popup();
  say('the popup names the unit move and offers no Keep (Go back)', /sold per piece → per kg [(]the quantity stays 2[)]/.test(shown.text) && /Go back/.test(shown.no) && !/Keep/.test(shown.no), shown.text.slice(0, 100));
  await finishWith('askok');
  say('Use new prices: the line is now sold per kg and the bill is still 236.00 (hand: price unchanged)', (await page.evaluate(() => CART[0].unit)) === 'kg' && (await net()) === 236, 'kg · 236.00');
  await setup('on', { unit: 'kg' }); await start(); await popup(); await finishWith('askno');
  say('Go back leaves the line per piece and asks for no owner', (await page.evaluate(() => CART[0].unit)) === 'piece' && (await page.evaluate(() => window.__owner)) === 0, 'piece');
  console.log('\n── unit unchanged (piece → piece) ──');
  await setup('on', { unit: 'piece' }); const calm = await page.evaluate(async () => JSON.stringify(await recheckBeforeBill()));
  say('nothing is shown: no popup opened, the door was asked once, 236.00', (await page.evaluate(() => document.getElementById('askdlg').open)) === false && (await page.evaluate(() => window.__posts)) === 1 && (await net()) === 236, calm.slice(0, 80));

  await setup('on', { unit: 'Kg' }); await page.evaluate(() => { CART[0].unit = 'kg'; });
  await page.evaluate(async () => { window.__r = recheckBeforeBill(); await window.__r; });
  say('unit kg → Kg (the same unit, case folded): no popup, 236.00', (await page.evaluate(() => document.getElementById('askdlg').open)) === false && (await net()) === 236, 'no popup');

  console.log('\n── a product the shop deleted ──');
  await setup('on', { found: false }); await start(); shown = await popup();
  say('only Remove them or Go back is offered, never a price', /Remove them/.test(shown.ok) && /Go back/.test(shown.no), shown.ok + ' / ' + shown.no);
  await finishWith('askok');
  say('removed: the line is off the bill, so it can never be billed', (await page.evaluate(() => CART.length)) === 0, 'cart empty');

  console.log('\n── Keep as quoted, price only ──');
  await setup('on', { price: 120 }); await start(); await popup(); const kept = await finishWith('askno');
  say('the owner is asked, 236.00 stays and the bill says who kept it', (await net()) === 236 && (await page.evaluate(() => window.__owner)) === 1 && /price kept/.test(kept), kept.slice(0, 160));

  console.log('\n── not due, and a failing door ──');
  await setup('off', { price: 120 }); const basis = await page.evaluate(async () => JSON.stringify(await recheckBeforeBill()));
  say('answered "off" and never parked: the door is not called, 236.00', (await page.evaluate(() => window.__posts)) === 0 && /snapshot_fresh/.test(basis) && (await net()) === 236, basis.slice(0, 80));
  await setup('on', 'fails'); const failed = await page.evaluate(async () => JSON.stringify(await recheckBeforeBill()));
  say('the door fails: the sale is not stopped, 236.00, reason recheck_failed', /recheck_failed/.test(failed) && (await net()) === 236, failed.slice(0, 80));

  say('no page error through all of it', errors.length === 0, errors.join(' | ').slice(0, 160) || 'none');
  await browser.close(); srv.close();
  console.log('\n' + (bad ? '✗ ' + bad + ' failed' : '✓ all checks passed') + '\n');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
