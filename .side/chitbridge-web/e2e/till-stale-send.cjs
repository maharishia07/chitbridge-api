/* till-stale-send.cjs — A BILL RUNG OFFLINE AT A PRICE THE SHOP HAD ALREADY CHANGED IS LOOKED AT BEFORE IT IS SENT (CTR-243, 13 Nov)
 *
 * Twin of api CTR-243 (tools/tally-connector/till.html staleGate, vendored here). Drives the real page with the real IndexedDB queue and a stand-in shop on the wire.
 *   a. PRICE ONLY (Athi A1): the bill goes as sold; the body the shop receives carries price_basis.stale_ack (via auto) and the bill's own total (236.00), unchanged.
 *   b. RATE MOVED (B1): the bill is HELD (_price_hold), the shop is not sent it, the rest of the queue goes, a reload keeps the hold, the popup is NOT raised while a bill is on the screen,
 *      then at an idle moment it is raised; "Not yet" sends nothing; the chip's decide button asks again; the owner PIN lets it go (stale_ack via send_as_sold, owner_pin true).
 *   c. THE DOOR FAILS (Athi, DECISIONS 0b876ee1): the bills wait on the ladder, the next drain asks again, at the ceiling they go with the mark stale_unchecked (chip "Prices not checked").
 * Hand figures: 2 x 100.00 excl at 18 intra = 236.00 (23600 minor); at 120.00 it would be 283.20 and at rate 12 it would be 224.00; neither is ever shown or sent.
 * Shots (when SHOTS=<dir> is set): the Bills list with the chip at 1366x768 and 390x844.
 * Run: node e2e/till-stale-send.cjs        (SHOTS=<dir> node e2e/till-stale-send.cjs  for the screenshots)   NODE_PATH must reach @playwright/test; run on SIT, not on a laptop that is busy.
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(78) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };
const iso = (h, m) => new Date(Date.UTC(2026, 10, 13, h, m)).toISOString();

(async () => {
  const wire = { recheck: 0, sent: [], door: 'ok', rows: [] };
  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url === '/api/till/recheck') {
      wire.recheck++;
      if (wire.door === 'fail') { r.writeHead(500, { 'content-type': 'application/json' }); return r.end('{"code":"X","message":"down"}'); }
      r.writeHead(200, { 'content-type': 'application/json' }); return r.end(JSON.stringify({ at: new Date().toISOString(), items: wire.rows, slabs: [], categories: [], face: {} }));
    }
    if (url === '/api/chits/send') {
      let body = ''; q.on('data', (c) => (body += c)); q.on('end', () => { try { wire.sent.push(JSON.parse(body)); } catch (_) { wire.sent.push({ raw: body }); } r.writeHead(200, { 'content-type': 'application/json' }); r.end('{"chit_id":"chit-' + wire.sent.length + '"}'); });
      return;
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
  const ctx = await b.newContext({ viewport: { width: 1366, height: 768 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(base + '/till.html');
  await p.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });

  const seed = (rows) => p.evaluate(async (a) => {
    CloudHost.key = 'demo-key'; CloudHost.api = a.api; HOST = CloudHost;
    ls.set(tillGivenKey(), 'C1');
    window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR', pay: [{ id: 'cash', label: 'Cash' }] }, at: a.snap, offers: [], slabs: [], categories: [], face: {}, items: [] };
    window.ownerPinAsk = async () => { window.__pin = (window.__pin || 0) + 1; return { by: { id: 'owner-1', name: 'Owner' } }; };
    window.__asked = []; window.sure = async (m, ok, title, no) => { window.__asked.push({ m: m, ok: ok, title: title, no: no }); return window.__yes !== false; };
    for (const r of a.rows) await DB.put('queue', r);
  }, { api: base, snap: iso(8, 0), rows });
  const billRow = (no, rate) => ({ no, at: iso(10, 0), total: 236, taxable: 200, tax: 36, kind: 'cash', payments: [{ how: 'cash', amount: 236 }], paid: 236,
    lines: [{ item_id: 'RICE', name: 'Rice 5 kg', qty: 2, price: 100, list_price: 100, mods: null, gst_rate: rate || 18, net: 200 }],
    price_basis: { checked: false, at: null, snapshot_at: iso(8, 0), parked_at: null, reason: 'offline' } });
  const answer = (o) => Object.assign({ item_id: 'RICE', name: 'Rice 5 kg', found: true, checked: true, active: true, status: 'available', price: 120, gst_rate: 18, changed_at: iso(9, 0) }, o || {});

  console.log('\n── a. a price-only move goes as sold, with the acknowledgement, and the figures untouched ' + '─'.repeat(2));
  wire.rows = [answer()];
  await seed([billRow('C1/1')]);
  await p.evaluate(() => HOST.drain({ force: true }));
  const a1 = wire.sent[0] && wire.sent[0].business_json;
  say('the shop was asked about the product once, and the bill was sent', wire.recheck === 1 && wire.sent.length === 1, 'recheck=' + wire.recheck + ' sent=' + wire.sent.length);
  say('the body carries stale_ack: price_moved, via auto, sold 100 now 120, owner_pin false', !!(a1 && a1.price_basis.stale_ack && a1.price_basis.stale_ack.reason === 'price_moved' && a1.price_basis.stale_ack.via === 'auto' && a1.price_basis.stale_ack.lines[0].sold.price === 100 && a1.price_basis.stale_ack.lines[0].current.price === 120 && a1.price_basis.stale_ack.owner_pin === false), JSON.stringify(a1 && a1.price_basis.stale_ack).slice(0, 120));
  say('the bill the customer holds is untouched: line price 100, quantity 2 (236.00 stays; 283.20 is never sent)', !!(wire.sent[0] && wire.sent[0].line_items[0].price === 100 && wire.sent[0].line_items[0].quantity === 2), JSON.stringify(wire.sent[0] && wire.sent[0].line_items[0]));

  console.log('\n── b. a rate move is held; the rest goes; a reload keeps it; never a popup mid-sale ' + '─'.repeat(2));
  wire.sent = []; wire.recheck = 0; wire.rows = [answer({ gst_rate: 12, price: 100 }), answer({ item_id: 'PEN', name: 'Pen', price: 10, changed_at: iso(7, 0) })];
  await p.evaluate(async () => { for (const r of await DB.all('queue')) await DB.del('queue', r.no); for (const r of await DB.all('bills')) await DB.del('bills', r.no); });
  const pen = billRow('C1/3'); pen.lines[0] = { item_id: 'PEN', name: 'Pen', qty: 1, price: 10, list_price: 10, mods: null, gst_rate: 18, net: 10 }; pen.total = 11.8;
  await seed([billRow('C1/2'), pen]);
  await p.evaluate(async () => { CART.push({ item_id: 'RICE', name: 'Rice 5 kg', qty: 1, price: 100 }); await HOST.drain({ force: true }); await new Promise((r) => setTimeout(r, 400)); });
  const held = await p.evaluate(async () => { const q = await DB.all('queue'); const by = {}; q.forEach((r) => { by[r.no] = r; }); return { hold: by['C1/2'] && by['C1/2']._price_hold, still: !!by['C1/2'], penGone: !by['C1/3'], asked: window.__asked.length, count: queueCount() }; });
  say('the rate-moved bill is HELD with its reason; the other bill (nothing moved) went', !!(held.hold && held.hold.reason === 'rate_moved' && held.still && held.penGone && wire.sent.length === 1), 'sent=' + wire.sent.length);
  say('a bill is on the screen: the popup was NOT raised (chip only), and the waiting count still says 1', held.asked === 0 && held.count === 1, 'asked=' + held.asked + ' count=' + held.count);
  await p.reload(); await p.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });
  const afterReload = await p.evaluate(async () => { const q = await DB.all('queue'); const row = q.filter((r) => r.no === 'C1/2')[0]; return !!(row && row._price_hold && row._price_hold.reason === 'rate_moved'); });
  say('after a reload the hold is still on the row', afterReload, String(afterReload));

  console.log('\n── at an idle moment the popup comes; "Not yet" sends nothing; the chip asks again; the owner PIN lets it go ' + '─'.repeat(2));
  await seed([]);
  wire.sent = [];
  const idle = await p.evaluate(async () => { window.__yes = false; await staleAskSoon(); const asked = window.__asked.slice(); const q = await DB.all('queue'); const row = q.filter((r) => r.no === 'C1/2')[0]; return { asked, still: !!row && !!row._price_hold, wasAsked: row && row._price_hold && row._price_hold.asked }; });
  say('the popup names the bill and the lines in values, never a total; both buttons; "Not yet" keeps it queued, asked once', idle.asked.length === 1 && idle.asked[0].ok === 'Send as sold' && idle.asked[0].no === 'Not yet' && /Rice 5 kg: GST was 18%, now 12%/.test(idle.asked[0].m) && !/283|224|would be/.test(idle.asked[0].m) && idle.still && idle.wasAsked === true && wire.sent.length === 0, JSON.stringify(idle.asked[0] && idle.asked[0].m).slice(0, 100));
  const chip = await p.evaluate(async () => { const row = (await DB.all('queue')).filter((r) => r.no === 'C1/2')[0]; return staleChipHTML(row, true); });
  say('the chip says "Price changed: not sent" and has the decide button', /Price changed: not sent/.test(chip) && /staleDecide\('C1\/2'\)/.test(chip), chip.slice(0, 60));
  await p.evaluate(async () => { window.__yes = true; await staleDecide('C1/2'); await new Promise((r) => setTimeout(r, 400)); });
  const released = wire.sent[0] && wire.sent[0].business_json.price_basis.stale_ack;
  say('"Send as sold" + the owner PIN: the bill is sent with the acknowledgement (send_as_sold, owner_pin true), total unchanged', !!(released && released.via === 'send_as_sold' && released.owner_pin === true && released.reason === 'rate_moved' && wire.sent[0].line_items[0].price === 100), JSON.stringify(released || {}).slice(0, 100));

  console.log('\n── c. the door fails (Athi, DECISIONS 0b876ee1): the bills WAIT, the next drain asks again, at the ladder ceiling they go marked "Prices not checked" ' + '─'.repeat(2));
  wire.sent = []; wire.door = 'fail'; wire.recheck = 0; wire.rows = [answer({ gst_rate: 12, price: 100 })];
  await p.evaluate(async () => { for (const r of await DB.all('queue')) await DB.del('queue', r.no); });
  await seed([billRow('C1/4'), billRow('C1/5')]);
  const door = await p.evaluate(async () => { await HOST.drain({ force: true }); const q = await DB.all('queue'); return { left: q.length, tries: q.map((r) => r._stale_tries).join(), note: (document.getElementById('lastnote') || {}).textContent || '' }; });
  say('door down: nothing is sent, both bills stay queued on the ladder (_stale_tries 1), the words say they wait', wire.sent.length === 0 && door.left === 2 && door.tries === '1,1' && /wait here and the check is tried again/.test(door.note), 'sent=' + wire.sent.length + ' tries=' + door.tries + ' note=' + door.note);
  wire.door = 'ok';
  const back = await p.evaluate(async () => { await HOST.drain({ force: true }); await new Promise((r) => setTimeout(r, 300)); const q = await DB.all('queue'); return { holds: q.filter((r) => r._price_hold).length }; });
  say('the next drain asks the door AGAIN, and the rate move it finds is HELD (not sent unchecked)', wire.recheck >= 2 && back.holds === 2 && wire.sent.length === 0, 'recheck=' + wire.recheck + ' holds=' + back.holds);
  wire.door = 'fail'; wire.sent = [];
  await p.evaluate(async () => { for (const r of await DB.all('queue')) await DB.del('queue', r.no); });
  await seed([billRow('C1/7')]);
  await p.evaluate(async () => { for (let i = 0; i < 9; i++) await HOST.drain({ force: true }); });
  const unchecked = wire.sent[0] && wire.sent[0].business_json.price_basis.stale_unchecked;
  say('at the ladder ceiling (9th failed check) the bill goes WITH the mark: stale_unchecked, tries 9, mode wait', !!(unchecked && unchecked.tries === 9 && unchecked.mode === 'wait' && wire.sent.length === 1), JSON.stringify(unchecked || {}));

  if (process.env.SHOTS) {
    fs.mkdirSync(process.env.SHOTS, { recursive: true });
    await seed([Object.assign(billRow('C1/6'), { _price_hold: { at: iso(11, 0), reason: 'rate_moved', asked: true, lines: [{ item_id: 'RICE', name: 'Rice 5 kg', reason: 'rate_moved', sold: { price: 100, gst_rate: 18 }, current: { price: 100, gst_rate: 12 } }] } })]);
    for (const [w, h] of [[1366, 768], [390, 844]]) { await p.setViewportSize({ width: w, height: h }); await p.evaluate(() => openBills(true)); await p.waitForTimeout(300); await p.screenshot({ path: path.join(process.env.SHOTS, 'ctr243-bills-' + w + '.png') }); }
  }
  say('no page errors', errs.length === 0, errs.join(' | ').slice(0, 160));
  await b.close(); srv.close();
  console.log(bad ? '\n  ' + bad + ' FAILED' : '\n  all ok');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
