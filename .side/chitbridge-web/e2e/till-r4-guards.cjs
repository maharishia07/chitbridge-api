/* till-r4-guards.cjs — Fable risk review 4 (the till), the two page findings, walked in a real browser.
 *   T4-01  one sale is ONE bill: a double click, two finish() calls in one tick, a held F9 — and a retry of a failed save is the same bill.
 *   T4-03  a refused IndexedDB call never becomes an empty second store: the number series keeps going, or the sale STOPS in words.
 * Each BAD case fails on the master before the fix and passes after; each GOOD case holds on both.
 * Run on a SIT box:  sh C:/dev/toolset/sit-box-run.sh sit-grund e2e <pushed-web-ref> e2e/till-r4-guards.cjs
 * Stand-ins: the page is served from public/ with no server behind it; HOST is a page-local object (as e2e/till-tidy.cjs); window.print is silenced. */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(78) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };
const ITEMS = [{ item_id: 'i1', name: 'Dosa', code: 'D1', category: 'Tiffin', unit: 'plate', price: 40, tax_rate: 5 }];

function web() {
  return http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
  });
}

/** a fresh page on the till, the shop set, one slow stand-in HOST that counts the bills it is asked to save */
async function tillPage(browser, WEB, init) {
  const ctx = await browser.newContext({ locale: 'en-IN', viewport: { width: 1366, height: 768 } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('  pageerror: ' + String(e).slice(0, 200)));
  await p.addInitScript(() => { window.print = function () {}; });
  if (init) await p.addInitScript(init);
  await p.goto(WEB + '/till.html');
  await p.waitForFunction(() => typeof modOpen === 'function' && typeof finish === 'function', null, { timeout: 30000 });
  await p.evaluate(async (items) => {
    window.S = { shop: { country: 'IN', name: 'Mayur Bhavan', currency: 'INR', gstin: '33ABCDE1234F1Z5', reg_type: 'regular' }, items: items, offers: [], at: new Date().toISOString() };
    CloudHost.key = 'demo-key'; await DB.reopen();   /* the key names the database: reopen it as the page does when the shop is set */
    ls.set(tillGivenKey(), 'C1'); window.WHO = { id: 'c1', name: 'Clerk', kind: 'coassist' };
    window.SAVED = [];
    window.HOST = { mode: 'cloud', key: 'demo-key',
      bill: async function (body) {
        await new Promise(function (r) { setTimeout(r, 400); });                      /* the slow part: the network, the state read */
        var s = Object.assign({}, body, { no: 'C1/26-27/' + String(window.SAVED.length + 1).padStart(4, '0'), at: new Date().toISOString() });
        window.SAVED.push(s); return { ok: true, bill: s, today: { count: window.SAVED.length, total: 0, by: {} } }; },
      bills: async function () { return window.SAVED.slice(); },
      state: async function () { return { snapshot: window.S, online: true, queued: 0, today: { count: window.SAVED.length, total: 0, by: {} }, till: { id: 'C1', name: 'Counter 1', host: 'this device' }, engines: {} }; } };
    setMode('sell'); applyLook(); try { stepsApply(); paintHits(); paintChips(); paintQuick(); paintSide(); } catch (_) {}
  }, ITEMS);
  await p.waitForTimeout(300);
  return { ctx, p };
}
const ring = (p) => p.evaluate(() => { document.querySelectorAll('dialog[open]').forEach((d) => d.close()); CART.length = 0; addItem(S.items[0], 1); price(); return CART.length; });
const saved = (p) => p.evaluate(() => window.SAVED.length);

(async () => {
  const srv = web(); await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const WEB = 'http://127.0.0.1:' + srv.address().port;
  const b = await chromium.launch();

  console.log('\n── T4-01 · one sale is one bill ' + '─'.repeat(30));
  {
    const { ctx, p } = await tillPage(b, WEB);
    await ring(p);
    const both = await p.evaluate(() => Promise.all([finish(), finish()]).then((r) => r.map((x) => !!(x && x.ok))));
    say('BAD  two finish() calls in one tick → ONE bill', (await saved(p)) === 1, 'bills saved: ' + (await saved(p)) + ', answers ' + JSON.stringify(both));
    say('     the second call answers { ok:false, busy:true }', both[0] === true && both[1] === false, '');

    await ring(p); const before = await saved(p);
    await p.dblclick('#save');
    await p.waitForTimeout(1200);
    say('BAD  a double click on Save & print → ONE more bill', (await saved(p)) === before + 1, 'bills saved: ' + (await saved(p)));

    await ring(p); const b2 = await saved(p);
    await p.evaluate(() => { for (var k = 0; k < 4; k++) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9', repeat: k > 0, bubbles: true })); });
    await p.waitForTimeout(1200);
    say('BAD  F9 held down (one press + 3 key repeats) → ONE more bill', (await saved(p)) === b2 + 1, 'bills saved: ' + (await saved(p)));

    await ring(p);
    const during = await p.evaluate(() => { var run = finish(); var off = document.getElementById('save').disabled; return run.then(function () { return off; }); });
    say('BAD  the Save button is greyed while the bill is being saved', during === true, 'disabled during save: ' + during);

    const b3 = await saved(p); await ring(p); await p.click('#save'); await p.waitForTimeout(1000);
    say('GOOD one press on a new sale saves exactly one bill (the guard lets go)', (await saved(p)) === b3 + 1, 'bills saved: ' + (await saved(p)));
    const numbers = await p.evaluate(() => window.SAVED.map((s) => s.no));
    say('GOOD every bill has its own number', new Set(numbers).size === numbers.length, numbers.join(' '));

    /* a save that THROWS must not leave the till stuck (the flag is released in a finally) */
    await p.evaluate(() => { window.HOST.bill = async function () { throw new Error('disk said no'); }; });
    await ring(p); await p.evaluate(() => finish()); await p.evaluate(() => { var d = document.querySelector('dialog[open]'); if (d) d.close(); });
    const again = await p.evaluate(() => { window.HOST.bill = async function (body) { var s = Object.assign({}, body, { no: 'RETRY1' }); window.SAVED.push(s); return { ok: true, bill: s, today: { count: 1, total: 0, by: {} } }; }; return finish().then((r) => !!(r && r.ok)); });
    say('GOOD after a failed save the next press works (nothing stuck busy)', again === true, '');
    await ctx.close();
  }

  console.log('\n── T4-01 · a retry of a failed save is the same bill ' + '─'.repeat(10));
  {
    const { ctx, p } = await tillPage(b, WEB);
    const r = await p.evaluate(async () => {
      window.HOST = CloudHost; CloudHost.drain = function () {}; CloudHost.state = async function () { return { today: { count: 0, total: 0, by: {} } }; };
      var lines = [{ item_id: 'i1', qty: 1, price: 40 }], body = function () { return { lines: lines, total: 40, payments: [{ how: 'Cash', amount: 40 }] }; };
      var realPut = DB.put, fails = 1;
      DB.put = function (store, row) { if (store === 'queue' && fails-- > 0) return Promise.reject(new Error('quota')); return realPut.call(DB, store, row); };
      var first = null, second = null;
      try { await CloudHost.bill(body()); } catch (e) { first = 'threw'; }
      second = await CloudHost.bill(body());
      var all = await DB.all('bills');
      var other = await CloudHost.bill({ lines: [{ item_id: 'i2', qty: 2, price: 10 }], total: 20, payments: [] });
      DB.put = realPut;
      return { first: first, no: second.bill.no, bills: all.map((x) => x.no), otherNo: other.bill.no };
    });
    say('BAD  a save that failed after taking its number: the retry reuses the number', r.first === 'threw' && r.bills.length === 1 && r.bills[0] === r.no, JSON.stringify(r));
    say('GOOD a different cart takes a new number', r.otherNo && r.otherNo !== r.no, r.otherNo);
    await ctx.close();
  }

  console.log('\n── T4-03 · a refused database never becomes an empty one ' + '─'.repeat(10));
  {
    const { ctx, p } = await tillPage(b, WEB);
    const nums = await p.evaluate(async () => { var out = []; for (var k = 0; k < 3; k++) out.push(await nextNumber()); return out; });
    const next0 = await p.evaluate(async () => (await DB.get('series')).next);
    say('GOOD three bills number 0001..0003 and the series is at 4', next0 === 4 && /0003$/.test(nums[2]), nums.join(' ') + ' · next ' + next0);

    /* one refused call (a connection closed under a backgrounded tab): the database is reopened and asked again */
    const blip = await p.evaluate(async () => {
      var real = IDBDatabase.prototype.transaction, left = 1;
      IDBDatabase.prototype.transaction = function () { if (left-- > 0) throw new DOMException('closing', 'InvalidStateError'); return real.apply(this, arguments); };
      try { return await nextNumber(); } catch (e) { return 'threw ' + e.message; } finally { IDBDatabase.prototype.transaction = real; }
    });
    say('BAD  one refused call → the next number is 0004, never 0001', /0004$/.test(String(blip)), String(blip));

    /* the database stays refused: the sale STOPS in words, no number is taken, nothing is written over */
    const stuck = await p.evaluate(async () => {
      var real = IDBDatabase.prototype.transaction, called = 0;
      IDBDatabase.prototype.transaction = function () { throw new DOMException('closing', 'InvalidStateError'); };
      var out = {};
      try { out.number = await nextNumber(); } catch (e) { out.code = e && e.code; out.words = e && e.message; }
      window.HOST.bill = async function () { called++; return { ok: true, bill: {} }; };
      CART.length = 0; addItem(S.items[0], 1); price();
      out.finish = await finish(); out.billCalls = called;
      out.dialog = (document.querySelector('dialog[open]') || {}).textContent || '';
      IDBDatabase.prototype.transaction = real;
      var d = document.querySelector('dialog[open]'); if (d) d.close();
      out.next = (await DB.get('series')).next;
      out.after = await nextNumber();
      return out;
    });
    say('BAD  a database that stays refused refuses the number (no 0001)', stuck.number === undefined && stuck.code === 'DB_REFUSED', JSON.stringify({ number: stuck.number, code: stuck.code }));
    say('BAD  finish() stops with the storage sentence and saves no bill', stuck.finish && stuck.finish.ok === false && stuck.billCalls === 0 && /storage stopped answering/.test(stuck.dialog), (stuck.dialog || '').slice(0, 90).replace(/\s+/g, ' '));
    say('BAD  the stored series is untouched and the next number carries on', stuck.next === 5 && /0005$/.test(String(stuck.after)), 'series next ' + stuck.next + ' · ' + stuck.after);
    await ctx.close();
  }
  {
    /* a device that has NEVER given the page a database (private window): the small store is the only store, and billing goes on */
    const { ctx, p } = await tillPage(b, WEB, () => { indexedDB.open = function () { throw new DOMException('denied', 'SecurityError'); }; });
    const n = await p.evaluate(async () => { var out = []; for (var k = 0; k < 3; k++) out.push(await nextNumber()); return { out: out, mem: MEM.on, stopped: await tillStopped() }; });
    say('GOOD no database ever: the small store numbers 0001..0003 and billing is not stopped', /0001$/.test(n.out[0]) && /0003$/.test(n.out[2]) && n.mem === true && n.stopped === false, n.out.join(' ') + ' · stopped ' + n.stopped);
    await ctx.close();
  }

  await b.close(); srv.close();
  console.log(bad ? '\n' + bad + ' FAILED' : '\nall OK'); process.exit(bad ? 1 : 0);
})().catch((e) => { console.log('✗ crashed: ' + e.stack); process.exit(1); });
