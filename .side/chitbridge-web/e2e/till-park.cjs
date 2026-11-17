/* till-park.cjs — A QUEUED CHANGE THE SHOP REFUSES FOR GOOD IS PARKED, SHOWN IN WORDS, AND FIXED OR DROPPED BY A PERSON (till-park, 12 Nov)
 *
 * Twin of api M9 (#1168 PRICE_DECIMALS, #1170 OFFER_CLASH): offline, "change it here anyway" queues a price; when the line returns the shop
 * answers 400 PRICE_DECIMALS. Before: the drain retried it every few minutes for ever. Now: it is parked ONCE, kept with the shop's own
 * sentence, and the owner sees it under "Needs fixing" in the why-is-a-bill-stuck panel with Fix (open the item) and Drop (owner PIN).
 * A bill (sale) row answered 5xx still retries on the ladder. Also: a JPY shop's bulk +10% rounds to whole yen; a finer typed price is refused.
 *
 * Drives the real page with the real IndexedDB queue and a stand-in shop on the wire. Keyboard-only pass on the panel (Tab to Fix, Enter).
 * Shots (when SHOTS=<dir> is set): the panel at 1366x768 and 390x844.
 * Run: node e2e/till-park.cjs        (SHOTS=<dir> node e2e/till-park.cjs  for the screenshots)
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
const SENTENCE = 'Price can have at most 2 decimal places in INR (not 10.999). Round it and send it again.';
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(66) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const wire = { price: 0, bill: 0, billStatus: 500, close: 0 };
  const srv = http.createServer((q, r) => {
    const url = q.url.split('?')[0];
    if (url === '/api/till/close') { wire.close++; r.writeHead(200, { 'content-type': 'application/json' }); return r.end('{"ok":true}'); }
    if (url === '/api/till/price') { wire.price++; r.writeHead(400, { 'content-type': 'application/json' }); return r.end(JSON.stringify({ code: 'PRICE_DECIMALS', message: SENTENCE })); }
    if (url === '/api/chits/send') { wire.bill++; r.writeHead(wire.billStatus, { 'content-type': 'application/json' }); return r.end(JSON.stringify({ code: 'X', message: 'the shop is busy' })); }
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

  await p.evaluate(async (api) => {
    CloudHost.key = 'demo-key'; CloudHost.api = api; HOST = CloudHost;
    ls.set(tillGivenKey(), 'C1');
    window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR', pay: [{ id: 'cash', label: 'Cash' }] }, at: new Date().toISOString(), offers: [],
                 items: [{ item_id: 'it-1', name: 'Basmati rice 1kg', price: 10, status: 'available' }] };
    window.sure = async () => true;
    window.ownerPinAsk = async () => ({ by: { id: 'o', name: 'Owner' } });
    window.refreshNow = function(){};
    await DB.put('queue', { no: 'OP/1', at: new Date().toISOString(), priority: 1, says: 'Basmati rice 1kg — price ₹10.00 → ₹10.999',
                            tillPost: { path: '/api/till/price', body: { item_id: 'it-1', price: 10.999 } } });
    await DB.put('queue', { no: 'C1/1', at: new Date().toISOString(), lines: [{ name: 'Tea', qty: 1, price: 10 }], total: 10, kind: 'cash' });
  }, base);

  console.log('\n── the refusal parks the change once; the bill keeps trying ' + '─'.repeat(5));
  const tried = await p.evaluate(async () => {
    await HOST.drain({ force: true }); await HOST.drain({ force: true }); await HOST.drain({ force: true });
    var q = await DB.all('queue'); var byNo = {}; q.forEach(function(r){ byNo[r.no] = r; });
    return { parked: byNo['OP/1'] && byNo['OP/1']._parked, why: byNo['OP/1'] && byNo['OP/1']._why, billParked: !!(byNo['C1/1'] && byNo['C1/1']._parked), billWait: byNo['C1/1'] && byNo['C1/1']._nextAt > Date.now(),
             counts: { q: STATE.queued, parked: QUEUED.parked } };
  });
  say('the price row is parked, with the shop\'s sentence', !!tried.parked && tried.why === SENTENCE, tried.why);
  say('the shop was asked about that price exactly once in three drains', wire.price === 1, String(wire.price));
  say('the bill (5xx) is NOT parked and waits on the ladder', !tried.billParked && tried.billWait, 'parked=' + tried.billParked);
  say('only the bill is "waiting to reach the shop"; the change is counted apart', tried.counts.q === 1 && tried.counts.parked === 1, JSON.stringify(tried.counts));

  console.log('\n── the panel says it in words, and a keyboard can fix or drop it ' + '─'.repeat(2));
  await p.evaluate(() => { window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR', pay: [] }, at: new Date().toISOString(), offers: [], items: [{ item_id: 'it-1', name: 'Basmati rice 1kg', price: 10, status: 'available' }] }; return openStuck(); });   /* a background read of the stand-in shop may have replaced S */
  await p.waitForSelector('[data-testid="till-parked-head"]');
  const panel = await p.evaluate(() => document.getElementById('billsbody').innerText);
  say('"Needs fixing" names the item and the shop\'s own sentence', /Needs fixing/.test(panel) && /Basmati rice/.test(panel) && panel.indexOf('at most 2 decimal places') >= 0, 'found');
  say('Fix and Drop are there, stamped from the register', await p.evaluate(() => !!document.querySelector('[data-testid="till-parked-fix-OP/1"][data-cbsid="CMP010"]') && !!document.querySelector('[data-testid="till-parked-drop-OP/1"][data-cbsid="CMP011"]')), 'CMP010 · CMP011');
  const shotDir = process.env.SHOTS;
  if (shotDir) { fs.mkdirSync(shotDir, { recursive: true }); await p.screenshot({ path: path.join(shotDir, 'till-park-1366x768.png') }); }
  if (shotDir) {
    const phone = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await phone.goto(base + '/till.html'); await phone.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });
    await phone.evaluate(async (api) => {
      CloudHost.key = 'demo-key'; CloudHost.api = api; HOST = CloudHost; ls.set(tillGivenKey(), 'C1');
      window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR', pay: [{ id: 'cash', label: 'Cash' }] }, at: new Date().toISOString(), offers: [], items: [{ item_id: 'it-1', name: 'Basmati rice 1kg', price: 10, status: 'available' }] };
      await DB.put('queue', { no: 'OP/1', at: new Date().toISOString(), says: 'Basmati rice 1kg — price ₹10.00 → ₹10.999', tillPost: { path: '/api/till/price', body: { item_id: 'it-1', price: 10.999 } }, _why: 'x', _parked: { at: 1, status: 400 } });
      await queueTally(); await openStuck();
    }, base);
    await phone.waitForSelector('[data-testid="till-parked-head"]');
    await phone.screenshot({ path: path.join(shotDir, 'till-park-390x844.png') });
    const overflow = await phone.evaluate(() => { var d = document.getElementById('billsdlg'); return d.scrollWidth > d.clientWidth + 1; });
    say('390px: the panel has no sideways scroll', !overflow, String(overflow));
  }
  // keyboard only: focus the dialog's first control, Tab until Fix has focus, then Enter
  await p.keyboard.press('Tab');
  let reached = '';
  for (let k = 0; k < 40 && reached !== 'till-parked-fix-OP/1'; k++) { reached = await p.evaluate(() => (document.activeElement && document.activeElement.getAttribute('data-testid')) || ''); if (reached !== 'till-parked-fix-OP/1') await p.keyboard.press('Tab'); }
  say('Tab reaches Fix inside the panel', reached === 'till-parked-fix-OP/1', reached);
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => !document.getElementById('billsdlg').open, null, { timeout: 5000 });
  const opened = await p.evaluate(() => ({ mode: MODE, card: CARD_ID }));
  say('Enter on Fix closes the panel and opens that item in Maintain', opened.mode === 'maintain' && opened.card === 'it-1', JSON.stringify(opened));

  console.log('\n── Drop is deliberate and the owner\'s ' + '─'.repeat(20));
  await p.evaluate(() => openStuck());
  await p.waitForSelector('[data-testid="till-parked-drop-OP/1"]');
  await p.focus('[data-testid="till-parked-drop-OP/1"]'); await p.keyboard.press('Enter');
  await p.waitForFunction(async () => !(await DB.all('queue')).some((r) => r.no === 'OP/1'), null, { timeout: 5000 });
  say('Drop (after the confirm and the owner PIN) removes the change from the queue', true, 'gone');
  say('the bill is still queued', await p.evaluate(async () => (await DB.all('queue')).some((r) => r.no === 'C1/1')), 'kept');

  console.log('\n── the price grain: a JPY shop ' + '─'.repeat(27));
  const jpy = await p.evaluate(async () => {
    S.shop.currency = 'JPY'; S.items = [{ item_id: 'a', name: 'A', price: 999 }, { item_id: 'b', name: 'B', price: 105 }];
    var out = { written: [], toasts: [] };
    window.ask = async () => '+10%'; window.priceWrite = async (i, v) => { out.written.push(v); return { ok: true }; }; window.pickedItems = function(){ return S.items; };
    var keep = window.toastLine; window.toastLine = function(t){ out.toasts.push(t); };
    await pickedPrice();
    window.ask = async () => '66.5'; await pickedPrice();
    window.toastLine = keep;
    out.finer = priceFinerWords(10.5);
    return out;
  });
  say('bulk +10% in JPY writes whole yen (999 -> 1099, 105 -> 116)', JSON.stringify(jpy.written) === '[1099,116]', JSON.stringify(jpy.written));
  say('a typed 66.5 in JPY is refused in the api\'s sentence, nothing written', jpy.written.length === 2 && /at most 0 decimal places in JPY/.test(jpy.finer), jpy.finer);

  console.log('\n── a clear of the store keeps a refused change: close the counter, wipe this device ' + '─'.repeat(2));
  const parkedRow = { no: 'OP/77', at: new Date().toISOString(), says: 'Basmati rice 1kg — price 10 → 10.999', tillPost: { path: '/api/till/price', body: { item_id: 'it-1', price: 10.999 } }, _why: 'w', _status: 400, _parked: { at: 1, status: 400 } };
  /* a fresh browser profile: the shared page above holds other stores and sent-bill rows that would (rightly) stop a close */
  const cp = await (await b.newContext({ viewport: { width: 1366, height: 768 } })).newPage();
  await cp.goto(base + '/till.html'); await cp.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });
  await cp.evaluate((api) => { CloudHost.key = 'demo-key-2'; CloudHost.api = api; HOST = CloudHost; ls.set(tillGivenKey(), 'C1'); DB.reopen(); }, base);
  const rawQueue = "(name) => new Promise((res) => { var rq = indexedDB.open(name, 1); rq.onupgradeneeded = function(){ rq.transaction.abort(); }; rq.onsuccess = function(){ var db = rq.result; if (!db.objectStoreNames.contains('queue')) { db.close(); return res(['no queue store']); } var g = db.transaction('queue', 'readonly').objectStore('queue').getAll(); g.onsuccess = function(){ db.close(); res(g.result.map((r) => r.no)); }; }; rq.onerror = function(){ res(['open failed']); }; })";
  const unreadable = await cp.evaluate(async ([row, reader]) => {
    window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR', pay: [] }, at: new Date().toISOString(), offers: [], items: [] };
    await DB.put('queue', row);
    window.sure = async () => true; window.becomeShop = function(){}; window._askOpen = async function(){}; window.busyShow = window.busyAt = window.busyDone = function(){};
    var said = []; window.say = function(m){ said.push(m); };
    var name = tillStore(), real = DB.allRaw; DB.allRaw = async function(){ if (/keepParked/.test(new Error().stack)) throw new Error('the database refused'); return real.apply(DB, arguments); };   /* only the parked-row read fails */
    await closeCounter(true);
    DB.allRaw = real;
    return { said: said, queue: await eval(reader)(name) };
  }, [parkedRow, rawQueue]);
  say('an unreadable queue stops the close with words: nothing cleared, the shop not told', /could not read the changes the shop refused, so closing the counter was stopped/.test(unreadable.said.join('|')) && JSON.stringify(unreadable.queue) === '["OP/77"]' && wire.close === 0, JSON.stringify(unreadable).slice(0, 260) + ' close posts=' + wire.close);
  const blocked = await cp.evaluate(async ([reader]) => {
    var said = [], asked = []; window.say = function(m){ said.push(m); };
    window.sure = async function(m, okWord){ asked.push(okWord); said.push(m); return false; };   /* the person has not pressed Reload yet */
    var name = tillStore();
    window.__hold = await new Promise((res) => { var rq = indexedDB.open(name, 1); rq.onupgradeneeded = function(){ rq.transaction.abort(); }; rq.onsuccess = function(){ res(rq.result); }; });   /* another tab holds the store open */
    await closeCounter(true);
    await new Promise((r) => setTimeout(r, 200));
    await queueTally(); paintStatus(); await openBills();   /* a refresh after "Not yet": what does the counter show? */
    var look = { bar: document.getElementById('queuenote').innerText, fixBtn: !!document.querySelector('#queuenote [data-testid="till-queue-fix"]'), pill: document.getElementById('daypill').textContent, bills: document.getElementById('billsbody').innerText, reload: !!document.querySelector('[data-testid="till-frozen-reload"]'), queued: STATE.queued, frozenFlag: QUEUED.frozen };
    document.getElementById('billsdlg').close();
    /* frozen: press Close and Wipe — neither may call the shop, touch the note, or clear anything; both say the frozen words */
    var posts = []; var realPost = HOST.tillPost; HOST.tillPost = function(path){ posts.push(path); return realPost.apply(this, arguments); };
    var noteBefore = ls.get('cb_kept_parked', ''), askedBefore = asked.length;
    await closeCounter(true); await closeCounter(); await wipeDevice(); await coldStart(true);
    HOST.tillPost = realPost;
    var stopped = { posts: posts, noteSame: ls.get('cb_kept_parked', '') === noteBefore && !!noteBefore, asked: asked.length - askedBefore, words: said.filter(function(m){ return /This counter is frozen, so/.test(m); }).length, note: JSON.parse(noteBefore).rows.length };
    await openStuck(); stopped.stuck = /Reload this counter/.test(document.getElementById('billsbody').innerText); document.getElementById('billsdlg').close();
    var stateRejected = ''; try { await HOST.state(); } catch (e) { stateRejected = e.code || 'x'; }
    var billSaid = '', billNo = null;
    try { var made = await HOST.bill({ lines: [{ name: 'Tea', qty: 1, price: 10 }], total: 10, kind: 'cash' }); billNo = made && made.bill && made.bill.no; } catch (e) { billSaid = String((e && e.message) || e); }   /* a sale at the counter while the clear is blocked */
    window.__hold.close();   /* the other tab closes: the late delete runs, the parked row is put back */
    for (var k = 0; k < 50 && JSON.stringify(await eval(reader)(name)) !== '["OP/77"]'; k++) await new Promise((r) => setTimeout(r, 100));
    return { look: look, stopped: stopped, said: said, asked: asked, billSaid: billSaid, billNo: billNo, after: await eval(reader)(name), note: !!ls.get('cb_kept_parked', '') };
  }, [rawQueue]);
  say('a store held open by another tab: the clear stops with words, and offers "Reload this counter"', /Close the other counter tab/.test(blocked.said.join('|')) && blocked.asked.indexOf('Reload this counter') >= 0, blocked.asked.join(',') + ' · ' + blocked.said.join('|').slice(0, 100));
  say('after "Not yet" the status bar says FROZEN with a Reload button (not "all sent", not 0)', /Frozen — close the other counter tab and then reload this counter/.test(blocked.look.bar) && blocked.look.fixBtn && !/everything has reached|waiting to reach/.test(blocked.look.bar), JSON.stringify(blocked.look.bar).slice(0, 110));
  say('...the day pill says frozen instead of 0.00, the Bills list says frozen with Reload (not an empty day), the QUEUED flag is set', /frozen/.test(blocked.look.pill) && /Reload this counter/.test(blocked.look.bills) && blocked.look.reload && blocked.look.frozenFlag === true, blocked.look.pill + ' · ' + JSON.stringify(blocked.look.bills).slice(0, 60));
  say('frozen + Close / Wipe / Repair: no call to the shop, the kept-rows note untouched, the frozen words shown with the Reload offer each time', blocked.stopped.posts.indexOf('/api/till/close') < 0 && blocked.stopped.noteSame && blocked.stopped.words === 4 && blocked.stopped.asked === 4 && blocked.stopped.note === 1, JSON.stringify(blocked.stopped));
  say('...and the 🩺 panel still opens (its unreadable queue is the frozen notice, not an empty list)', blocked.stopped.stuck === true, String(blocked.stopped.stuck));
  say('a bill attempted after the block is REFUSED with words (nothing numbered, nothing written)', /Reload this counter/.test(blocked.billSaid) && !blocked.billNo, blocked.billSaid.slice(0, 120));
  say('...and when the other tab lets go the late delete still restores the parked change, and the refused bill left no trace in the queue', JSON.stringify(blocked.after) === '["OP/77"]' && blocked.note, JSON.stringify(blocked.after) + ' note=' + blocked.note);
  await cp.reload(); await cp.waitForFunction(() => typeof window.screenSet === 'function', null, { timeout: 30000 });
  const reloaded = await cp.evaluate(async ([api, reader]) => {
    CloudHost.key = 'demo-key-2'; CloudHost.api = api; HOST = CloudHost; ls.set(tillGivenKey(), 'C1'); DB.reopen();
    var name = tillStore(); await reviveKept();
    var wrote = true; try { await DB.put('bills', { no: 'C1/61', at: new Date().toISOString(), lines: [], total: 0 }); } catch (e) { wrote = false; }
    var out = { queue: await eval(reader)(name), wrote: wrote, note: !!ls.get('cb_kept_parked', ''), bills: (await DB.allRaw('bills')).map((r) => r.no) };
    await DB.del('bills', 'C1/61'); await DB.del('queue', 'C1/61');   /* the probe row goes again */
    return out;
  }, [base, rawQueue]);
  say('after Reload the counter starts clean: writable again, the parked change present once, the saved note forgotten, no half-written bill', JSON.stringify(reloaded.queue) === '["OP/77"]' && reloaded.wrote && !reloaded.note && JSON.stringify(reloaded.bills) === '["C1/61"]', JSON.stringify(reloaded));
  const closed = await cp.evaluate(async (row) => {
    window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR', pay: [] }, at: new Date().toISOString(), offers: [], items: [] };
    await DB.put('queue', row); await DB.put('bills', { no: 'C1/50', at: new Date().toISOString(), lines: [], total: 0, _sent: { at: 1 } });
    window.sure = async () => true; window.becomeShop = function(){}; window._askOpen = async function(){}; window.busyShow = window.busyAt = window.busyDone = function(){};
    var said = []; window.say = function(m){ said.push(m); };
    var name = tillStore();   /* the shop's own store, read raw by the name the clear used (the key is gone after a close) */
    await closeCounter(true);
    DB.reopen();
    var read = (name) => new Promise((res) => { var rq = indexedDB.open(name, 1); rq.onupgradeneeded = function(){ rq.transaction.abort(); }; rq.onsuccess = function(){ var db = rq.result; if (!db.objectStoreNames.contains('queue')) { db.close(); return res(['no queue store']); } var g = db.transaction('queue', 'readonly').objectStore('queue').getAll(); g.onsuccess = function(){ db.close(); res(g.result.map((r) => r.no)); }; }; rq.onerror = function(){ res(['open failed']); }; });
    return { name: name, queue: await read(name), said: said };
  }, parkedRow);
  say('closing the counter keeps the parked change and clears the bills', JSON.stringify(closed.queue) === '["OP/77"]', JSON.stringify(closed).slice(0, 400));
  const store = await cp.evaluate(async (row) => { DB.reopen(); await DB.put('queue', row); return tillStore(); }, parkedRow);   /* the close left the page unpaired: seed the parked row again in the store it now reads */
  const afterWipe = (async () => {
    await cp.waitForEvent('load', { timeout: 20000 });
    return cp.evaluate(async (name) => new Promise((res) => { var rq = indexedDB.open(name, 1); rq.onupgradeneeded = function(){ rq.transaction.abort(); }; rq.onsuccess = function(){ var db = rq.result; if (!db.objectStoreNames.contains('queue')) { db.close(); return res(['no queue store']); }
      var g = db.transaction('queue', 'readonly').objectStore('queue').getAll(); g.onsuccess = function(){ db.close(); res(g.result.map((r) => r.no)); }; }; rq.onerror = function(){ res(['open failed']); }; }), store);
  })();
  await cp.evaluate(async () => { window.sure = async () => true; wipeDevice(); });
  const wiped = await afterWipe;
  say('wiping the device keeps the parked change (the same store, the same shop stamp)', JSON.stringify(wiped) === '["OP/77"]', JSON.stringify(wiped));

  say('no page errors', errs.length === 0, errs.join(' | ') || 'none');
  await b.close(); srv.close();
  console.log('\n' + (bad ? bad + ' FAILED' : 'all passed'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
