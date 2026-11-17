/* till-returns-faults.cjs — the smaller return faults (backlog M11, 2026-09-28), one case each, on the browser counter
 *
 * Each case names the fault it pins. The page is the real till.html (served locally), talking to a stand-in
 * ChitBridge; no live server, no real shop.
 *
 * Run: node e2e/till-returns-faults.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const SI = require('./lib/signin.cjs');
const { recheckStub } = require('./lib/recheck-stub.cjs');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'public');
const T = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
            '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(70) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

(async () => {
  const web = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  const sent = [], HISTORY = [];
  const api = http.createServer(async (q, r) => {
    let raw = ''; for await (const c of q) raw += c;
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    const j = (c2, o) => { r.writeHead(c2, Object.assign({ 'content-type': 'application/json' }, cors)); r.end(JSON.stringify(o)); };
    if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
    const u = q.url.split('?')[0];
    if (u === '/api/till/snapshot') return j(200, { at: new Date().toISOString(), entity_id: 'ent-x', shop: { country: 'IN', name: 'Shop X', bridge_id: 'CB-X' },
      till: { suggested_id: 'C1', assigned_id: 'C1' },
      items: [{ id: 'xmango', item_id: 'xmango', name: 'XMANGO', price: 50, unit: 'nos', code: 'XMANGO' }] });
    if (u === '/api/till/recheck') return j(200, recheckStub(raw, { xmango: 50 }));   /* nothing moved: a bare {ok:true} reads as an unreachable door and the bill waits (CTR-243, decision C) */
    if (u === '/api/till/bills') return j(200, { bills: HISTORY });
    if ((u === '/api/entities/register' || u === '/api/signin/ask')) return j(200, { message: 'sent', dev_otp: '123456' });
    if ((u === '/api/entities/verify' || u === '/api/signin/verify')) return j(200, { token: 'T', identity: { identity_id: 'p-x', user_id: 'xclerk', display_name: 'X Clerk', identity_type: 'actor', entity_id: 'ent-x' } });
    if (u === '/api/chits/send') { try { sent.push(JSON.parse(raw)); } catch (_) {} return j(200, { chit_id: 'c' + sent.length }); }
    return j(200, { ok: true });
  });
  await new Promise((res) => web.listen(0, '127.0.0.1', res));
  await new Promise((res) => api.listen(0, '127.0.0.1', res));
  const API = 'http://127.0.0.1:' + api.address().port;
  const b = await chromium.launch();
  const ctx = await b.newContext();
  await ctx.addInitScript((a) => {
    if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    localStorage.setItem('cb_till_api', a); localStorage.setItem('cb_till_key', 'KEY-X');
    localStorage.setItem('cb_till_autolock@', '0');
  }, API);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('http://127.0.0.1:' + web.address().port + '/till.html');
  await p.waitForFunction(() => typeof retMoney === 'function' && typeof refresh === 'function', null, { timeout: 30000 });
  await p.evaluate(() => refresh().catch(function(){}));
  await p.waitForFunction(() => S && S.shop && S.shop.name === 'Shop X', null, { timeout: 30000 });
  /* a cashier on the counter, through the one sign-in — a counter with nobody on it refuses to bill */
  await SI.signIn(p, 'xclerk'); await SI.signedIn(p);          /* the one window (CBSignin, #68) — e2e/lib/signin.cjs */
  await p.evaluate(() => usignClose());

  console.log('\n── M11 · ⚠️ partial returns may never reverse more than was charged (the last return is the remainder) ' + '─'.repeat(0));
  /* the measured case from the backlog: a line taxed ₹12.04 over 8 units, returned one unit at a time */
  const r1 = await p.evaluate(() => {
    var bill = { no: 'C1/26-27/0042', at: new Date().toISOString(), total: 112.04,
      lines: [{ name: 'Pen', qty: 8, net: 112.04, gross: 112.04, taxable: 100, tax: 12.04, save: 0, gst_rate: 12 }] };
    RET_FOR = bill; RET_PRIOR = {};
    var sum = { tax: 0, net: 0, taxable: 0 };
    for (var i = 0; i < 8; i++) {
      RET_QTY = { 0: 1 };
      var m = retMoney();
      var cn = { kind: 'credit_note', against: { bill_no: bill.no }, lines: m.lines };
      (RET_PRIOR[bill.no] = RET_PRIOR[bill.no] || []).push(cn);
      sum.tax = r2(sum.tax + m.tax); sum.net = r2(sum.net + m.total); sum.taxable = r2(sum.taxable + m.taxable);
    }
    var left = retLeft(bill, 0);
    RET_FOR = null; RET_PRIOR = null; RET_QTY = null;
    return { sum: sum, left: left };
  });
  say('eight one-unit returns reverse EXACTLY the ₹12.04 of GST charged', r1.sum.tax === 12.04, 'tax ' + r1.sum.tax);
  say('and exactly the line: ₹112.04 net, ₹100 taxable', r1.sum.net === 112.04 && r1.sum.taxable === 100, JSON.stringify(r1.sum));
  say('and nothing is left to return', r1.left === 0, 'left ' + r1.left);

  console.log('\n── M11 · ⚠️ a bill rung at 23:58 can be returned at 00:01 (the store held it; today-only said it did not) ' + '─'.repeat(0));
  /* a real sale through the screen, then its time moved to 23:58 yesterday in this device's own store */
  await p.fill('#q', 'XMANGO');
  await p.waitForSelector('[data-testid="till-add-0"]', { timeout: 20000 });
  await p.click('[data-testid="till-add-0"]');
  await p.click('[data-testid="till-pay-cash"]');
  await p.fill('#tendered', '500');
  await p.click('#save');
  await p.waitForSelector('#sliptitle', { timeout: 20000 });
  await p.evaluate(() => { try { document.getElementById('slipdlg').close(); } catch (_) {} });
  const old = await p.evaluate(async () => {
    var all = await DB.all('bills'); var b = all.filter(function(x){ return x && x.lines && x.kind !== 'credit_note'; }).pop();
    /* ⚠️ TWO days back, late evening: the counter's "today" is a UTC date, so "23:58 yesterday" in India is still
       "today" to it until 05:30 — a separate finding (reported), not what this case is about */
    var y = new Date(); y.setDate(y.getDate() - 2); y.setHours(23, 58, 0, 0);
    b.at = y.toISOString(); await DB.put('bills', b);
    return { no: b.no, at: b.at, total: b.total };
  });
  HISTORY.push({ no: old.no, at: old.at, total: old.total, customer: 'Walk-in' });
  const today = await p.evaluate(async () => (await HOST.bills()).map(function(b){ return b.no; }));
  say('(set-up) yesterday\'s bill is NOT in today\'s list — the old path could not find it', today.indexOf(old.no) < 0, old.no + ' at ' + old.at.slice(0, 16));
  await p.evaluate(() => { BILLS_TAB = 'earlier'; return openBills(true); });
  await p.waitForSelector('[data-testid="till-old-' + old.no + '"]', { timeout: 10000 });
  const btn = p.locator('[data-testid="till-old-' + old.no + '"] [data-testid="till-bill-return-' + old.no + '"]');
  say('the Earlier tab offers "return" on a bill this counter still holds', await btn.count() === 1, 'button present');
  await btn.click();
  await p.waitForSelector('#retdlg[open]', { timeout: 10000 });
  await p.click('[data-testid="till-ret-all"]');
  await p.click('[data-testid="till-return-go"]');
  await p.waitForSelector('#askdlg[open]', { timeout: 10000 });
  await p.click('#askok');
  await p.waitForFunction(() => /Credit note/.test(document.getElementById('sliptitle').textContent || ''), null, { timeout: 20000 });
  await p.evaluate(() => { try { document.getElementById('slipdlg').close(); } catch (_) {} });
  const cnAgainst = await p.evaluate(async () => { var c = (await DB.all('bills')).filter(function(x){ return x.kind === 'credit_note'; }).pop(); return c && c.against && c.against.bill_no; });
  say('⭐ the credit note is issued against yesterday\'s bill', cnAgainst === old.no, 'against ' + cnAgainst);
  const again = await p.evaluate(async (no) => { await retOpen(no); var open = document.getElementById('retdlg').open; var left = RET_FOR ? retLeft(RET_FOR, 0) : null; retClose(); return { open: open, left: left }; }, old.no);
  say('and it cannot be returned twice — the earlier credit note is found across days', again.left === 0, 'left ' + again.left);

  console.log('\n── M11 · the day report on a returns-only day, and a sheet that reconciles to itself ' + '─'.repeat(0));
  /* today holds only the credit note from the case above (its bill was moved to yesterday) — a returns-only day */
  const d0 = await p.evaluate(async () => { var b = await todayBills(); var h = dayReportHTML(b || []);
    return { kinds: (b || []).map(function(x){ return x.kind || 'sale'; }), none: /No sales yet today/.test(h), returns: /Credit note/.test(h), nan: /NaN/.test(h) }; });
  say('(set-up) today is a returns-only day', d0.kinds.length > 0 && d0.kinds.every((k) => k === 'credit_note'), JSON.stringify(d0.kinds));
  say('⚠️ it no longer says "No sales yet today" — the Returns table is on the sheet', !d0.none && d0.returns && !d0.nan, JSON.stringify({ none: d0.none, returns: d0.returns, nan: d0.nan }));
  /* and a sale today: the net of "how the money moved" equals Net sales */
  await p.fill('#q', 'XMANGO');
  await p.waitForSelector('[data-testid="till-add-0"]', { timeout: 20000 });
  await p.click('[data-testid="till-add-0"]');
  await p.click('[data-testid="till-pay-cash"]');
  await p.fill('#tendered', '500');
  await p.click('#save');
  await p.waitForSelector('#sliptitle', { timeout: 20000 });
  await p.evaluate(() => { try { document.getElementById('slipdlg').close(); } catch (_) {} });
  const d1 = await p.evaluate(async () => { await dayReport(); var net = document.querySelector('[data-testid="till-dayrep-net"]');
    var ns = document.querySelector('[data-testid="till-dayrep-netsales"]'); var out = { net: net && net.textContent, netSales: ns && ns.textContent }; dayReportClose(); return out; });
  say('⭐ the money that moved nets to exactly the Net sales figure', !!d1.net && d1.net === d1.netSales, JSON.stringify(d1));

  console.log('\n── M11 · ⚠️⚠️ closing the counter accounts for a credit note too (it was destroyed with the local store) ' + '─'.repeat(0));
  /* the state the old close missed: a credit note the counter issued, never confirmed, not on the queue */
  const bare = await p.evaluate(async () => {
    var cn = (await DB.all('bills')).filter(function(x){ return x.kind === 'credit_note'; }).pop();
    delete cn._sent; await DB.put('bills', cn);
    var q = (await DB.allRaw('queue')) || []; for (var i = 0; i < q.length; i++) if (q[i] && q[i].no === cn.no) await DB.del('queue', q[i].no);
    return cn.no;
  });
  const before = sent.filter((c) => c.client_ref === bare).length;
  p.evaluate(() => { closeCounter(true); }).catch(() => {});
  for (let i = 0; i < 60 && sent.filter((c) => c.client_ref === bare).length === before; i++) await new Promise((r) => setTimeout(r, 250));
  say('⭐ the close RE-SENDS the unconfirmed credit note before it clears anything', sent.filter((c) => c.client_ref === bare).length > before, bare);
  await p.waitForSelector('#askdlg[open]', { timeout: 20000 }).catch(() => {});
  const closedSaid = await p.evaluate(() => (document.getElementById('askbody') || {}).textContent || '').catch(() => '');
  say('and only then closes', /closed on this PC/i.test(closedSaid), '"' + closedSaid.slice(0, 60) + '"');

  console.log('\nconsole/page errors:', errs.length ? errs.join(' | ').slice(0, 300) : 'none');
  say('no page errors', errs.length === 0, errs.length + ' error(s)');
  await b.close(); web.close(); api.close();
  console.log('\n' + (bad ? '✗ ' + bad + ' FAILED\n' : '✓ all good\n'));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
