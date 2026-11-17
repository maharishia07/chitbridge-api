/* till-two-sided.cjs — ⭐⭐ THE TWO-SIDED COUNTER BILL, through the real counter (Athi, 2026-10-01)
 *
 * *"Naming a connected customer on a credit or named bill IS the sending."* A bill to a customer the counter KNOWS and who
 * is a business ON THE RAIL (the snapshot's customers[].entity_id) is sent with
 *     recipients [{ self:true, name:'self' }, { name, entity_id, role:'to', self:false }]
 * so the customer holds their own copy to accept or dispute. Everyone else stays self-only.
 *
 * ONE REAL COUNTER, ONE STAND-IN SERVER: the real till.html (CloudHost, IndexedDB) in a browser; a stand-in API on a port
 * the OS chooses records every chit it is sent (client_ref kept once). No database, no localhost:3000, no live site.
 *
 * PROVES, through the counter's own controls:
 *   · a CREDIT bill to Kumar (on the rail) arrives with TWO recipients, the second his entity, role 'to'; the slip says
 *     "Sent to Kumar"
 *   · a NAMED cash bill to Kumar: two recipients too (a named bill IS the sending)
 *   · a walk-in: one recipient (self) · Latha, known but NOT on the rail (no entity_id): one recipient
 *   · offline: the same bills are queued; the queued row already builds the two-recipient chit (chitOf); back online they
 *     arrive with the same recipients, and nothing else changed
 * Break each guard once: e2e/till-two-sided-breaks.cjs.
 * Run: node e2e/till-two-sided.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path');
const SI = require('./lib/signin.cjs');
const ENG = path.join(__dirname, '..', 'public', 'engine');
const SHOTS = path.join(__dirname, '..', 'test-results', 'till-two-sided');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WT = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
             '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(76) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };

const KUMAR_ENTITY = '9b2f6a10-4c1e-4d2a-9f3b-0a1b2c3d4e5f';
const ITEMS = [
  { id: 'rice', item_id: 'rice', name: 'RICE 1KG', price: 52.5, unit: 'nos', code: 'RICE1', gst_rate: 5 },
  { id: 'soap', item_id: 'soap', name: 'SOAP BAR', price: 39, unit: 'nos', code: 'SOAP1', gst_rate: 18 },
];
/* Kumar: a business on the rail (entity_id, as routes/till.js now sends it). Latha: known, terms, NOT on the rail. */
const CUSTOMERS = [
  { identity_id: KUMAR_ENTITY, entity_id: KUMAR_ENTITY, name: 'Kumar', phone: '9876500001', groups: [], credit_days: 15, credit_limit_minor: 10000000, balance_minor: 0, open_bills: [] },
  { identity_id: 'id-latha', name: 'Latha', phone: '9876500002', groups: [], credit_days: 7, credit_limit_minor: 10000000, balance_minor: 0, open_bills: [] },
];

const SEEN = { kept: new Map(), arrivals: [] };
function apiFront() {
  const line = { dead: false };
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  line.server = http.createServer(async (q, r) => {
    if (line.dead) return q.socket.destroy();
    let raw = ''; for await (const c of q) raw += c;
    const j = (code, o) => { r.writeHead(code, Object.assign({ 'content-type': 'application/json' }, cors)); r.end(JSON.stringify(o)); };
    if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
    const u = q.url.split('?')[0];
    const b = raw ? (() => { try { return JSON.parse(raw); } catch (_) { return {}; } })() : {};
    if ((u === '/api/entities/register' || u === '/api/signin/ask')) return j(200, { message: 'sent', dev_otp: '123456' });
    if ((u === '/api/entities/verify' || u === '/api/signin/verify')) return j(200, { token: 'T', identity: { identity_id: 'p-x', user_id: 'xclerk', display_name: 'X Clerk', identity_type: 'actor', entity_id: 'ent-x' } });
    if (u === '/api/till/snapshot') return j(200, { books: true, at: new Date().toISOString(), version: 'x-1', entity_id: 'ent-x',
      shop: { country: 'IN', name: 'Shop X', bridge_id: 'CB-X', currency: 'INR', pay: [{ id: 'cash', label: 'Cash' }, { id: 'upi', label: 'UPI' }] },
      till: { suggested_id: 'C1', assigned_id: 'C1' }, items: ITEMS, customers: CUSTOMERS });
    if (u.indexOf('/api/till/engine/') === 0) {
      const f = path.join(ENG, u.split('/').pop().replace(/\.js$/, '') + '.js');
      if (!fs.existsSync(f)) return j(404, {});
      r.writeHead(200, Object.assign({ 'content-type': 'application/javascript' }, cors)); return r.end(fs.readFileSync(f));
    }
    if (u === '/api/chits/send') {
      SEEN.arrivals.push(b);
      if (!b.client_ref) return j(400, { message: 'no client_ref' });
      if (SEEN.kept.has(b.client_ref)) return j(200, { chit_id: SEEN.kept.get(b.client_ref)._id, duplicate: true });
      const c = Object.assign({ _id: 'chit-' + (SEEN.kept.size + 1) }, b); SEEN.kept.set(b.client_ref, c);
      return j(200, { chit_id: c._id });
    }
    return j(200, { ok: true });
  });
  return line;
}
const recipOf = (no) => { const c = SEEN.kept.get(no); return c ? c.recipients : null; };
const two = (rs, name) => Array.isArray(rs) && rs.length === 2 && rs[0].self === true
  && rs[1].entity_id === KUMAR_ENTITY && rs[1].role === 'to' && rs[1].self === false && rs[1].name === name;
const one = (rs) => Array.isArray(rs) && rs.length === 1 && rs[0].self === true;

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const L = apiFront();
  await new Promise((res) => L.server.listen(0, '127.0.0.1', res));
  const ROOT = path.join(__dirname, '..', 'public');
  const web = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': WT[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((res) => web.listen(0, '127.0.0.1', res));

  const b = await chromium.launch();
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((a) => {
    if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    localStorage.setItem('cb_till_api', a); localStorage.setItem('cb_till_key', 'KEY-X');
  }, 'http://127.0.0.1:' + L.server.address().port);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(String(e)));

  /* the one sign-in window (CBSignin, #68) through its own controls — e2e/lib/signin.cjs */
  const signIn = async () => {
    await SI.signIn(p, 'xclerk'); await SI.signedIn(p);
    await p.evaluate(() => usignClose());
  };
  /** one sale through the real controls → { no, slip } */
  const sell = async (o) => {
    for (const it of o.items) {
      await p.fill('#q', it);
      const id = ITEMS.filter((x) => x.name.indexOf(it) === 0)[0].id;
      await p.waitForSelector('[data-testid="till-hit-0"][data-item="' + id + '"]', { timeout: 20000 });
      await p.click('[data-testid="till-add-0"]');
    }
    if (o.name != null) await p.fill('#cname', o.name);
    if (o.phone != null) await p.fill('#cphone', o.phone);
    await p.evaluate(() => { try { paintPays(); } catch (_) {} });
    await p.click('[data-testid="till-pay-' + o.pay + '"]');
    const before = await p.evaluate(() => (document.getElementById('sliptitle') || {}).textContent || '');
    await p.click('#save');
    await p.waitForFunction((t) => { var d = document.getElementById('slipdlg'); var s = (document.getElementById('sliptitle') || {}).textContent || '';
      return d && d.open && s && s !== t; }, before, { timeout: 20000 });
    const slip = await p.evaluate(() => document.getElementById('slipbox').innerText.replace(/\s+/g, ' '));
    const no = (await p.textContent('#sliptitle')).replace(/^.*?((?:[A-Z]+\/)?C\d\/\S+).*$/, '$1').trim();
    if (o.shot) await p.screenshot({ path: path.join(SHOTS, o.shot + '.png') });
    await p.evaluate(() => { try { document.getElementById('slipdlg').close(); } catch (_) {} });
    await p.evaluate(() => { var a = document.getElementById('cname'), b2 = document.getElementById('cphone'); if (a) a.value = ''; if (b2) b2.value = ''; });
    return { no, slip };
  };
  const drain = async () => {
    for (let i = 0; i < 40; i++) {
      await p.evaluate(async () => { try { await refresh(); } catch (_) {} if (HOST.drain) await HOST.drain({ force: true }); }).catch(() => {});
      if (!(await p.evaluate(async () => (await DB.all('queue')).length))) return 0;
      await sleep(250);
    }
    return p.evaluate(async () => (await DB.all('queue')).length);
  };

  try {
    await p.goto('http://127.0.0.1:' + web.address().port + '/till.html');
    await p.waitForFunction(() => typeof refresh === 'function', null, { timeout: 30000 });
    await p.evaluate(() => refresh().catch(function(){}));
    await p.waitForFunction(() => S && S.shop && S.shop.name === 'Shop X' && (S.customers || []).length === 2 && S.books === true, null, { timeout: 30000 });
    await signIn();

    console.log('\n── ⭐ ONLINE: who gets a copy ' + '─'.repeat(40));
    const a = await sell({ items: ['RICE', 'SOAP'], name: 'Kumar', phone: '9876500001', pay: 'credit', shot: 'credit-to-kumar' });
    await drain();
    say('a CREDIT bill to Kumar (on the rail) is sent with TWO recipients — self, and his entity as "to"', two(recipOf(a.no), 'Kumar'), JSON.stringify(recipOf(a.no)));
    say('…the slip says "Sent to Kumar", in one line', /Sent to Kumar/.test(a.slip) && /ON CREDIT/.test(a.slip), (a.slip.match(/ON CREDIT.{0,60}/) || ['—'])[0]);
    const kb = SEEN.kept.get(a.no) || {};
    say('…the bill names him by both ids, and keeps its own number as client_ref', kb.business_json && kb.business_json.customer.entity_id === KUMAR_ENTITY
      && kb.business_json.customer.identity_id === KUMAR_ENTITY && kb.client_ref === a.no && kb.purpose === 'order', JSON.stringify(kb.business_json && kb.business_json.customer));
    const d = await sell({ items: ['SOAP'], name: 'Kumar', phone: '9876500001', pay: 'cash' });
    await drain();
    say('a NAMED cash bill to Kumar: two recipients too (naming a connected customer IS the sending)', two(recipOf(d.no), 'Kumar') && /Sent to Kumar/.test(d.slip), JSON.stringify(recipOf(d.no)));
    const w = await sell({ items: ['RICE'], pay: 'cash' });
    await drain();
    say('a walk-in: ONE recipient, self — and no "Sent to" on the slip', one(recipOf(w.no)) && !/Sent to/.test(w.slip), JSON.stringify(recipOf(w.no)));
    const l = await sell({ items: ['SOAP'], name: 'Latha', phone: '9876500002', pay: 'credit' });
    await drain();
    say('Latha — known, on credit, but NOT on the rail: ONE recipient, the shop\'s own record', one(recipOf(l.no)) && !/Sent to/.test(l.slip) && /ON CREDIT/.test(l.slip), JSON.stringify(recipOf(l.no)));

    console.log('\n── ⭐⭐ OFFLINE: the queue carries the recipient, nothing else changes ' + '─'.repeat(4));
    L.dead = true;
    const n0 = SEEN.arrivals.length;
    const oa = await sell({ items: ['RICE'], name: 'Kumar', phone: '9876500001', pay: 'credit' });
    const ow = await sell({ items: ['SOAP'], pay: 'cash' });
    const ol = await sell({ items: ['RICE'], name: 'Latha', phone: '9876500002', pay: 'credit' });
    const q = await p.evaluate(async () => (await DB.all('queue')).map(function(row){ return { no: row.no, recipients: chitOf(row).recipients }; }));
    const qOf = (no) => (q.filter((x) => x.no === no)[0] || {}).recipients;
    say('with the line DOWN all three are queued, nothing reached the server', q.length >= 3 && SEEN.arrivals.length === n0 && !SEEN.kept.has(oa.no), 'queue ' + q.length + ' · arrivals +' + (SEEN.arrivals.length - n0));
    say('…the queued credit bill to Kumar already builds the TWO-recipient chit', two(qOf(oa.no), 'Kumar'), JSON.stringify(qOf(oa.no)));
    say('…the queued walk-in and Latha\'s bill build ONE', one(qOf(ow.no)) && one(qOf(ol.no)), JSON.stringify([qOf(ow.no), qOf(ol.no)]));
    say('…and the offline slip says "Sent to Kumar" all the same (the copy goes when the line does)', /Sent to Kumar/.test(oa.slip), (oa.slip.match(/Sent to \w+/) || ['—'])[0]);
    L.dead = false;
    const left = await drain();
    say('the line returns: the queue empties', left === 0, 'left ' + left);
    say('…Kumar\'s bill arrives with the same two recipients', two(recipOf(oa.no), 'Kumar'), JSON.stringify(recipOf(oa.no)));
    say('…the walk-in and Latha\'s with one', one(recipOf(ow.no)) && one(recipOf(ol.no)), JSON.stringify([recipOf(ow.no), recipOf(ol.no)]));
    const ok = SEEN.kept.get(oa.no) || {};
    say('…and the offline bill is the online bill\'s shape: purpose, number, customer, lines', ok.purpose === 'order' && ok.client_ref === oa.no
      && ok.business_json && ok.business_json.bill_no === oa.no && ok.business_json.customer.entity_id === KUMAR_ENTITY && (ok.line_items || []).length === 1,
      JSON.stringify({ purpose: ok.purpose, ref: ok.client_ref, lines: (ok.line_items || []).length }));
    say('every bill reached the server exactly once', [a, d, w, l, oa, ow, ol].every((x) => SEEN.kept.has(x.no)) && SEEN.kept.size === 7, 'kept ' + SEEN.kept.size);
    say('no page errors', errs.length === 0, errs.slice(0, 3).join(' | ') || 'none');
  } catch (e) { bad++; console.log('  ✗ the harness threw: ' + (e && e.stack)); try { await p.screenshot({ path: path.join(SHOTS, 'threw.png') }); } catch (_) {} }
  await b.close(); L.server.close(); web.close();
  console.log('\n' + (bad ? '✗ ' + bad + ' FAILED' : '✓ all passed') + '\n');
  process.exit(bad ? 1 : 0);
})();
