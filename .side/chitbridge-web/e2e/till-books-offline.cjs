/* till-books-offline.cjs — ⭐⭐⭐ THE OFFLINE PROOF: a day at two counters, taken with the line DOWN, arrives exactly once
 *
 * Athi, 2026-09-29: *"we are running offline and we have to have a bullet proof system which i am not confident
 * enough … we don't claim as an accounting system until we are well confident, but still record the information
 * according to principle."* [SPEC-books-v2 §7.4 · SPEC-credit-lifecycle §11]
 *
 * TWO REAL COUNTERS, ONE STAND-IN SERVER:
 *   C1 — the shop PC: the REAL till.js, run from a COPY of the kit on a free port (never the repo folder), its page in
 *        a browser. Its line to the server can be cut.
 *   C2 — the browser counter: the real till.html (CloudHost, IndexedDB), its line cut the same way.
 *   The server records every chit it is sent, keeps each client_ref ONCE (the unique index ux_chit_client_ref_per_entity),
 *   and runs the posting engine (chitbridge-engines posting.js) on what it kept: walk-in bills summed per counter per
 *   day at day close, named/credit bills per bill, payments received, returns, expenses.
 *
 * THE DAY (all through the counters' own controls, both lines DOWN): walk-ins in cash/UPI/card, credit sales (one
 * within the limit, one over it — refused on a wrong owner PIN, allowed on the right one), a customer with no terms,
 * returns, an expense, money received (cash, UPI, and a cheque that stays "received, not cleared").
 * THEN: the shop PC is killed mid-queue and restarted · the line comes back LOSSY (the server keeps a chit and the
 * answer is lost, so the counter sends it again) · the day is closed · a LATE bill arrives after the close · every
 * chit is replayed.
 * PROVES: every document reaches the server exactly once · every posting balances to the paisa · the walk-in day
 * entries equal the sum of the counters' own bills, per mode · the late bill is a SUPPLEMENTARY entry and the closed
 * entry is untouched · the restart lost nothing · the two counters' numbers never collide · the replay changed
 * nothing · the customer's account moves by exactly the credit given less the money received (the cheque held).
 *
 * ⚠️ BREAK IT: BREAK=idempotency node e2e/till-books-offline.cjs — the server stops keeping client_ref once, and this
 * harness must FAIL on the double post. (Run once on 2026-09-29; see the commit message.)
 *
 * Run: node e2e/till-books-offline.cjs
 */
'use strict';
const { chromium } = require('@playwright/test');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), net = require('net'), crypto = require('crypto');
const { spawn } = require('child_process');
const KIT = path.join(__dirname, '..', '..', 'chitbridge-api', 'tools', 'tally-connector');
const ENG = path.join(__dirname, '..', 'public', 'engine');
const POSTING = require(path.join(__dirname, '..', '..', 'chitbridge-engines', 'src', 'posting.js'));
const SHOTS = path.join(__dirname, '..', 'test-results', 'till-books-offline');
const BREAK = process.env.BREAK || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const jwt = (p) => b64({ alg: 'HS256' }) + '.' + b64(p) + '.stub';
const WT = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
             '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let bad = 0;
const say = (l, ok, d) => { console.log('  ' + String(l).padEnd(72) + '· ' + d + '  ' + (ok ? 'OK' : (bad++, '✗ FAILED'))); };
const freePort = () => new Promise((res) => { const t = net.createServer(); t.listen(0, '127.0.0.1', () => { const n = t.address().port; t.close(() => res(n)); }); });
const P = (v) => Math.round(Number(v || 0) * 100);           /* paisa — every comparison below is in whole paisa */
const R = (p) => (p / 100).toFixed(2);
const TODAY = new Date().toISOString().slice(0, 10);

/* ── the shop both counters sell for ─────────────────────────────────────────────────────────────────────────── */
const ITEMS = [
  { id: 'rice', item_id: 'rice', name: 'RICE 1KG', price: 52.5, unit: 'nos', code: 'RICE1', gst_rate: 5 },
  { id: 'soap', item_id: 'soap', name: 'SOAP BAR', price: 39, unit: 'nos', code: 'SOAP1', gst_rate: 18 },
  { id: 'milk', item_id: 'milk', name: 'MILK 500', price: 27, unit: 'nos', code: 'MILK1', gst_rate: 0 },
];
/* ⭐ the customers, as the snapshot now carries them (routes/till.js): Kumar has terms, a limit and a bill already open;
   Latha is known but the shop set no terms (the snapshot says nothing → "limit unknown offline"); two Manis = nobody */
const CUSTOMERS = [
  { identity_id: 'id-kumar', name: 'Kumar', phone: '9876500001', groups: [], credit_days: 15, credit_limit_minor: 100000,
    balance_minor: 20000, open_bills: [{ ref: 'OLD/0001', balance_minor: 20000, due_date: '2026-09-20', date: '2026-09-05' }] },
  { identity_id: 'id-latha', name: 'Latha', phone: '9876500002', groups: [] },
  { identity_id: 'id-mani-1', name: 'Mani', phone: null, groups: [] },
  { identity_id: 'id-mani-2', name: 'Mani', phone: null, groups: [] },
];

/* ══ THE STAND-IN SERVER: what it keeps, and the posting engine run on it ══════════════════════════════════════ */
const LEDGER = {
  kept: new Map(),        /* client_ref → the chit, ONCE (the unique index) */
  arrivals: [],           /* every send, duplicates included */
  duplicates: 0,
  entries: [],            /* { source_ref, type, counter, day, lines, supplementary } */
  closed: {},             /* 'C1|2026-09-29' → true once the day is closed */
  walkinPosted: new Set(),/* client_refs already inside a walk-in day entry */
  refused: [],            /* postings the engine refused — each must be one we EXPECT (an uncleared cheque) */
  held: [],               /* cheques received, not cleared: recorded, not posted */
};
const modeOf = (how) => {
  const h = String(how || '').toLowerCase();
  if (/credit/.test(h)) return 'credit';
  if (/upi|gpay|phonepe|paytm/.test(h)) return 'upi';
  if (/card/.test(h)) return 'card';
  if (/cheque|check/.test(h)) return 'cheque';
  if (/bank/.test(h)) return 'bank';
  return 'cash';
};
/** a line's tax split — the price is tax-INCLUSIVE at the counter (the MRP a customer pays) */
function taxesOf(lines) {
  const by = {};
  (lines || []).forEach((l) => {
    const r = Number(l.gst_rate || 0), t = Math.abs(P(l.total));
    const taxable = Math.round(t * 100 / (100 + r)), tax = t - taxable, cg = Math.round(tax / 2);
    const k = String(r); by[k] = by[k] || { rate: r, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    by[k].taxable += taxable; by[k].cgst += cg; by[k].sgst += tax - cg;
  });
  return Object.keys(by).map((k) => ({ rate: by[k].rate, taxable: R(by[k].taxable) * 1, cgst: R(by[k].cgst) * 1, sgst: R(by[k].sgst) * 1, igst: 0 }));
}
const lineSum = (lines) => (lines || []).reduce((a, l) => a + Math.abs(P(l.total)), 0);
const counterOf = (c) => (c.business_json && c.business_json.till && c.business_json.till.id) || '?';
const dayOf = (c) => String((c.business_json && c.business_json.billed_at) || (c.business_json && c.business_json.payment_received && c.business_json.payment_received.at) || '').slice(0, 10) || TODAY;
const isSale = (c) => c.purpose === 'order' && c.business_json && c.business_json.bill_no && !c.business_json.refund;
const isCredit = (c) => isSale(c) && (((c.business_json.payment || {}).parts || []).some((x) => modeOf(x.how) === 'credit') || !!c.business_json.terms);
function postOne(ev, meta) {
  const r = POSTING.post(Object.assign({ currency: 'INR', date: meta.day }, ev), { country: 'IN' });
  if (!r.ok) { LEDGER.refused.push({ ref: meta.source_ref, why: r.why }); return null; }
  const e = Object.assign({ lines: r.lines, type: ev.type }, meta);
  LEDGER.entries.push(e);
  return e;
}
/** what the server does with a chit it has just KEPT (never with one it already had) */
function onKept(c) {
  const bj = c.business_json || {}, day = dayOf(c), counter = counterOf(c);
  if (bj.payment_received) {
    const p = bj.payment_received;
    if (p.mode === 'cheque' && p.status !== 'cleared') { LEDGER.held.push(c.client_ref); return; }   /* C3: posted when it CLEARS */
    return postOne({ type: 'payment_received', mode: modeOf(p.mode), amount: p.amount, party: p.party && p.party.identity_id,
                     cheque_status: p.status }, { source_ref: c.client_ref, counter, day });
  }
  if (c.purpose === 'expense') {
    return postOne({ type: 'expense', class: 'sundry_expense', amount: bj.expense.amount, paid_from: modeOf(bj.expense.mode) },
                   { source_ref: c.client_ref, counter, day });
  }
  if (c.purpose === 'credit_note') {
    const parts = (bj.refund && bj.refund.parts) || [], refund = {};
    parts.forEach((x) => { const m = modeOf(x.how); refund[m] = R(P(refund[m] || 0) + P(x.amount)) * 1; });
    const total = P(bj.refund && bj.refund.total);
    if (!parts.length) refund.cash = R(total) * 1;
    /* the refund is what the lines add to; a difference is REPORTED (a mismatch is refused by the engine, never absorbed) */
    return postOne({ type: 'return', by_rate: taxesOf(c.line_items), refund }, { source_ref: c.client_ref, counter, day, refund_minor: total, lines_minor: lineSum(c.line_items) });
  }
  if (isCredit(c)) {
    const paid = {}; let charged = 0;
    (bj.payment.parts || []).forEach((x) => { charged += P(x.amount); const m = modeOf(x.how); if (m !== 'credit') paid[m] = R(P(paid[m] || 0) + P(x.amount)) * 1; });
    return postOne({ type: 'sale_bill', party: bj.customer && bj.customer.identity_id, paid, by_rate: taxesOf(c.line_items),
                     round_off: R(charged - lineSum(c.line_items)) * 1 }, { source_ref: c.client_ref, counter, day });
  }
  /* a walk-in bill waits for its day's close; one that arrives AFTER the close is settled as a supplementary entry */
}
function walkinBill(c) {
  const pay = {}; let charged = 0;
  (c.business_json.payment.parts || []).forEach((x) => { charged += P(x.amount); const m = modeOf(x.how); pay[m] = R(P(pay[m] || 0) + P(x.amount)) * 1; });
  return { currency: 'INR', pay, taxes: taxesOf(c.line_items), round_off: R(charged - lineSum(c.line_items)) * 1 };
}
function walkinsWaiting(counter, day) {
  return [...LEDGER.kept.values()].concat(BREAK === 'idempotency' ? LEDGER.extra || [] : [])
    .filter((c) => isSale(c) && !isCredit(c) && counterOf(c) === counter && dayOf(c) === day && !LEDGER.walkinPosted.has(c._key || c.client_ref));
}
/** ⭐ DAY CLOSE: one walk-in entry per counter per day (SPEC-books v1 granularity 'day') */
function dayClose(counter, day) {
  const k = counter + '|' + day; if (LEDGER.closed[k]) return null;
  const w = walkinsWaiting(counter, day);
  LEDGER.closed[k] = true;
  if (!w.length) return null;
  const ev = POSTING.daySummary(w.map(walkinBill), { ref: 'walkin:' + k, date: day, counter });
  const e = postOne(ev, { source_ref: 'walkin:' + counter + ':' + day, counter, day, bills: w.map((c) => c.client_ref) });
  if (e) w.forEach((c) => LEDGER.walkinPosted.add(c._key || c.client_ref));
  return e;
}
/** ⭐ a walk-in bill for a CLOSED day is never an edit of the closed entry — it is a supplementary one */
function settleLate() {
  const made = [];
  Object.keys(LEDGER.closed).forEach((k) => {
    const [counter, day] = k.split('|');
    const w = walkinsWaiting(counter, day);
    if (!w.length) return;
    const n = LEDGER.entries.filter((e) => e.supplementary && e.counter === counter && e.day === day).length + 1;
    const ev = POSTING.daySummary(w.map(walkinBill), { ref: 'walkin:' + k + ':supp-' + n, date: day, counter });
    const e = postOne(ev, { source_ref: 'walkin:' + counter + ':' + day + ':supp-' + n, counter, day, supplementary: true, bills: w.map((c) => c.client_ref) });
    if (e) { w.forEach((c) => LEDGER.walkinPosted.add(c._key || c.client_ref)); made.push(e); }
  });
  return made;
}
/** the server's door. `lossy` = keep the chit and lose the answer (the counter must send it again) */
function receive(body, line) {
  LEDGER.arrivals.push({ ref: body.client_ref, via: line.name, at: Date.now() });
  const ref = body.client_ref;
  if (!ref) return { code: 400, out: { message: 'no client_ref' } };
  if (LEDGER.kept.has(ref)) {
    LEDGER.duplicates++;
    if (BREAK === 'idempotency') {   /* ⚠️ THE BREAK: the unique index dropped — a second copy is kept and posted */
      const copy = Object.assign({}, body, { _key: ref + '#' + LEDGER.duplicates });
      (LEDGER.extra = LEDGER.extra || []).push(copy);
      onKept(copy);
      return { code: 200, out: { chit_id: 'dup-' + LEDGER.duplicates } };
    }
    return { code: 200, out: { chit_id: LEDGER.kept.get(ref)._id, duplicate: true } };
  }
  const c = Object.assign({}, body, { _id: 'chit-' + (LEDGER.kept.size + 1) });
  LEDGER.kept.set(ref, c);
  onKept(c);
  return { code: 200, out: { chit_id: c._id } };
}

/* ══ one API front per counter, so each counter's line can be cut on its own ══════════════════════════════════ */
function apiFront(name, tillId) {
  /* books = the shop's ledger is ON (the snapshot says so, review M5) · hold = the line is up but no chit gets through */
  const line = { name, dead: false, lossy: 0, lost: 0, books: true, hold: false };
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  line.server = http.createServer(async (q, r) => {
    if (line.dead) return q.socket.destroy();                 /* ⚠️ the line is DOWN — no answer at all, as a real outage */
    let raw = ''; for await (const c of q) raw += c;
    const j = (code, o) => { r.writeHead(code, Object.assign({ 'content-type': 'application/json' }, cors)); r.end(JSON.stringify(o)); };
    if (q.method === 'OPTIONS') { r.writeHead(204, cors); return r.end(); }
    const u = q.url.split('?')[0];
    const b = raw ? (() => { try { return JSON.parse(raw); } catch (_) { return {}; } })() : {};
    if ((u === '/api/entities/register' || u === '/api/signin/ask')) return j(200, { message: 'sent', dev_otp: '123456' });
    if ((u === '/api/entities/verify' || u === '/api/signin/verify')) return j(200, { token: 'T', identity: { identity_id: 'p-x', user_id: 'xclerk', display_name: 'X Clerk', identity_type: 'actor', entity_id: 'ent-x' } });
    if (u === '/api/till/snapshot') return j(200, Object.assign(line.books ? { books: true } : {}, { at: new Date().toISOString(), version: 'x-1', entity_id: 'ent-x',
      shop: { country: 'IN', name: 'Shop X', bridge_id: 'CB-X', currency: 'INR', pay: [{ id: 'cash', label: 'Cash' }, { id: 'upi', label: 'UPI' }, { id: 'card', label: 'Card' }] },
      till: { suggested_id: tillId, assigned_id: tillId }, items: ITEMS, customers: CUSTOMERS }));
    if (u.indexOf('/api/till/engine/') === 0) {
      const f = path.join(ENG, u.split('/').pop().replace(/\.js$/, '') + '.js');
      if (!fs.existsSync(f)) return j(404, {});
      r.writeHead(200, Object.assign({ 'content-type': 'application/javascript' }, cors)); return r.end(fs.readFileSync(f));
    }
    if (u === '/api/chits/send') {
      if (line.hold) return q.socket.destroy();               /* never reached the server at all */
      const got = receive(b, line);
      if (line.lossy > 0 && !(got.out && got.out.duplicate)) { line.lossy--; line.lost++; return q.socket.destroy(); }  /* KEPT, answer lost */
      return j(got.code, got.out);
    }
    /* the shop PC's harness answers an unknown GET with 404 (till-return-pc); the browser counter reads a 404 as offline */
    if (q.method === 'GET' && name === 'C1') return j(404, { message: 'not in this stand-in' });
    return j(200, { ok: true });
  });
  return line;
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  if (BREAK) console.log('\n⚠️⚠️ BREAK=' + BREAK + ' — this run MUST fail\n');
  const L1 = apiFront('C1', 'C1'), L2 = apiFront('C2', 'C2');
  await new Promise((res) => L1.server.listen(0, '127.0.0.1', res));
  await new Promise((res) => L2.server.listen(0, '127.0.0.1', res));
  const ROOT = path.join(__dirname, '..', 'public');
  const web = http.createServer((q, r) => {
    const f = path.join(ROOT, decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('no'); }
    r.writeHead(200, { 'content-type': WT[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(r);
  });
  await new Promise((res) => web.listen(0, '127.0.0.1', res));

  /* ── C1: the real shop-PC program, from a COPY of the kit ── */
  const PORT = await freePort();
  const KEY = jwt({ identity_id: 'ent-x', bridge_id: 'CB-X', display_name: 'Shop X', kind: 'api_key', scopes: ['till'] });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cbbooks-'));
  const kit = path.join(home, 'kit'); fs.mkdirSync(kit);
  fs.readdirSync(KIT).filter((n) => /\.(js|html)$/.test(n)).forEach((n) => fs.copyFileSync(path.join(KIT, n), path.join(kit, n)));
  const cfgFile = path.join(home, 'connector.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ api: 'http://127.0.0.1:' + L1.server.address().port, key: KEY, till: { id: 'C1' } }, null, 2));
  let out = '', proc = null;
  const startPC = () => {
    proc = spawn(process.execPath, [path.join(kit, 'till.js'), '--config', cfgFile, '--port', String(PORT)], { cwd: kit, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', (d) => { out += d; }); proc.stderr.on('data', (d) => { out += d; });
  };
  const pcState = () => fetch('http://127.0.0.1:' + PORT + '/api/state').then((x) => x.json()).catch(() => null);
  startPC();
  for (let i = 0; i < 100 && !(await pcState()); i++) await sleep(150);

  const b = await chromium.launch();
  const errs = [];
  /* the shop-PC page */
  const pc = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  pc.on('pageerror', (e) => errs.push('C1 ' + String(e)));
  /* the browser counter — its own origin, its own IndexedDB */
  const ctx2 = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx2.addInitScript((a) => {
    if (sessionStorage.getItem('seeded')) return; sessionStorage.setItem('seeded', '1');
    localStorage.setItem('cb_till_api', a); localStorage.setItem('cb_till_key', 'KEY-X');
  }, 'http://127.0.0.1:' + L2.server.address().port);
  const br = await ctx2.newPage();
  br.on('pageerror', (e) => errs.push('C2 ' + String(e)));

  const signIn = async (p) => {
    await p.evaluate(() => usignOpen());
    await p.fill('[data-testid="signin-id"]', 'xclerk');
    await p.click('[data-testid="signin-go"]');
    await p.waitForSelector('[data-testid="signin-code"]');
    if (!(await p.inputValue('[data-testid="signin-code"]'))) await p.fill('[data-testid="signin-code"]', '123456');
    await p.click('[data-testid="signin-verify"]');
    await p.waitForSelector('[data-testid="till-usign-in"], [data-testid="signin-later"]', { timeout: 15000 });
    if (await p.locator('[data-testid="signin-later"]').count()) await p.click('[data-testid="signin-later"]');
    await p.evaluate(() => usignClose());
  };
  const closeSlip = (p) => p.evaluate(() => { try { document.getElementById('slipdlg').close(); } catch (_) {} });
  /** one sale through the real controls; returns the bill number the slip shows ('' when no bill was made) */
  const sell = async (p, o) => {
    for (const it of o.items) {
      await p.fill('#q', it);
      /* ⚠️ wait for the list to BE the search — clicking the first row of the previous list added RICE for MILK */
      const id = ITEMS.filter((x) => x.name.indexOf(it) === 0)[0].id;
      await p.waitForSelector('[data-testid="till-add-0"]', { timeout: 20000 });
      if (!LEDGER.hitShown) { LEDGER.hitShown = 1; console.log('    (first row: ' + await p.evaluate(() => (document.querySelector('[data-testid="till-hit-0"]') || {}).outerHTML.slice(0, 200)) + ')'); }
      await p.waitForSelector('[data-testid="till-hit-0"][data-item="' + id + '"]', { timeout: 20000 });
      await p.click('[data-testid="till-add-0"]');
    }
    if (o.name != null) { await p.fill('#cname', o.name); }
    if (o.phone != null) { await p.fill('#cphone', o.phone); }
    await p.evaluate(() => { try { paintPays(); } catch (_) {} });
    await p.click('[data-testid="till-pay-' + o.pay + '"]');
    if (process.env.SHOW_LOG) console.log('    (picked ' + await p.evaluate(() => PICKED + ' · known=' + !!custKnown() + ' · cart=' + CART.length) + ')');
    if (o.tendered) await p.fill('#tendered', String(o.tendered));
    const before = await p.evaluate(() => (document.getElementById('sliptitle') || {}).textContent || '');
    await p.click('#save');
    if (o.short) {   /* ⚠️ under-tendered: refused, said, nothing saved — then the right amount is taken */
      await p.waitForSelector('#askdlg[open]', { timeout: 10000 });
      o.shortSaid = await p.evaluate(() => document.getElementById('askdlg').innerText.replace(/\s+/g, ' '));
      o.shortSlip = await p.evaluate(() => { var d = document.getElementById('slipdlg'); return !!(d && d.open); });
      await p.click('#askok');
      await p.fill('#tendered', String(o.short));
      await p.click('#save');
    }
    if (o.pin !== undefined) {
      await p.waitForSelector('#askdlg[open]', { timeout: 10000 });
      o.asked = await p.evaluate(() => document.getElementById('askdlg').innerText.replace(/\s+/g, ' '));
      o.masked = await p.evaluate(() => document.getElementById('askinput').type);
      await p.fill('#askinput', o.pin);
      await p.click('#askok');
      if (o.expectRefused) {
        await sleep(600);
        o.said = await p.evaluate(() => { var d = document.getElementById('askdlg'); return d && d.open ? d.innerText.replace(/\s+/g, ' ') : ''; });
        await p.evaluate(() => { try { document.getElementById('askdlg').close(); } catch (_) {} });
        return '';
      }
    }
    await p.waitForFunction((t) => { var d = document.getElementById('slipdlg'); var s = (document.getElementById('sliptitle') || {}).textContent || '';
      return d && d.open && s && s !== t; }, before, { timeout: 20000 });
    o.slip = await p.evaluate(() => (document.getElementById('slipbody') || document.getElementById('slipdlg')).innerText.replace(/\s+/g, ' '));
    const no = (await p.textContent('#sliptitle')).replace(/^.*?((?:[A-Z]+\/)?C\d\/\S+).*$/, '$1').trim();
    await closeSlip(p);
    await p.evaluate(() => { var a = document.getElementById('cname'), b2 = document.getElementById('cphone'); if (a) a.value = ''; if (b2) b2.value = ''; try { paintRcvPayBtn(); } catch (_) {} });
    return no;
  };
  const returnAll = async (p, no) => {
    await p.evaluate(() => openBills());
    const btn = p.locator('[data-testid="till-bill-return-' + no + '"]').first();
    await btn.waitFor({ timeout: 15000 });
    await btn.click();
    await p.click('[data-testid="till-ret-all"]');
    await p.click('[data-testid="till-return-go"]');
    await p.waitForSelector('#askdlg[open]', { timeout: 10000 });
    await p.click('#askok');
    await p.waitForFunction(() => /Credit note/.test(document.getElementById('sliptitle').textContent || ''), null, { timeout: 20000 });
    const cn = (await p.textContent('#sliptitle')).replace(/^Credit note\s*/, '').trim();
    await closeSlip(p);
    await p.evaluate(() => { try { document.querySelectorAll('dialog[open]').forEach(function(d){ d.close(); }); } catch (_) {} });
    return cn;
  };
  const receivePay = async (p, o) => {
    await p.fill('#cphone', o.phone);
    await p.waitForSelector('[data-testid="till-receive-pay"]:not([hidden])', { timeout: 5000 });
    await p.click('[data-testid="till-receive-pay"]');
    await p.waitForSelector('#rcvpaydlg[open]', { timeout: 5000 });
    await p.fill('[data-testid="till-rp-amount"]', String(o.amount));
    await p.selectOption('[data-testid="till-rp-mode"]', o.mode);
    if (o.cheque) {
      if (o.cheque.no) await p.fill('[data-testid="till-rp-chq-no"]', o.cheque.no);
      await p.fill('[data-testid="till-rp-chq-bank"]', o.cheque.bank || '');
    }
    o.proposal = await p.evaluate(() => document.getElementById('rp_prop').innerText.replace(/\s+/g, ' '));
    await p.click('[data-testid="till-rp-save"]');
    await sleep(400);
    o.said = await p.evaluate(() => { var d = document.getElementById('askdlg'); return d && d.open ? d.innerText.replace(/\s+/g, ' ') : ''; });
    if (o.said) { await p.evaluate(() => document.getElementById('askdlg').close()); await p.evaluate(() => { try { document.getElementById('rcvpaydlg').close(); } catch (_) {} }); }
    const note = await p.evaluate(() => (document.getElementById('lastnote') || {}).textContent || '');
    await p.fill('#cphone', '');
    await p.evaluate(() => { try { paintRcvPayBtn(); } catch (_) {} });
    o.note = note;
    return o.said ? '' : ((note.match(/— (R\/\S+?)\.?(\s|$)/) || [])[1] || '');
  };

  try {
    await pc.goto('http://127.0.0.1:' + PORT + '/');
    await pc.waitForFunction(() => typeof AgentHost !== 'undefined' && S && S.shop && S.shop.name === 'Shop X' && (S.customers || []).length === 4, null, { timeout: 60000 });
    L2.books = false;                                        /* ⚠️ C2 first reads a shop whose ledger is OFF */
    await br.goto('http://127.0.0.1:' + web.address().port + '/till.html');
    await br.waitForFunction(() => typeof refresh === 'function', null, { timeout: 30000 });
    await br.evaluate(() => refresh().catch(function(){}));
    await br.waitForFunction(() => S && S.shop && S.shop.name === 'Shop X' && (S.customers || []).length === 4 && (S.items || []).length === 3, null, { timeout: 30000 });
    const offer = async (p, name, phone) => p.evaluate(({ name, phone }) => {
      document.getElementById('cname').value = name; document.getElementById('cphone').value = phone; paintPays(); paintRcvPayBtn();
      var r = { credit: !!document.querySelector('[data-testid="till-pay-credit"]'), receive: !document.getElementById('rcvpaybtn').hidden };
      document.getElementById('cname').value = ''; document.getElementById('cphone').value = ''; paintPays(); paintRcvPayBtn();
      return r;
    }, { name, phone });
    const shopRead = (n) => br.waitForFunction((k) => S && S.shop && S.shop.name === 'Shop X' && (S.customers || []).length === 4 && (S.items || []).length === 3 && (k == null || (S.books === true) === k), n, { timeout: 30000 });
    console.log('\n── ⚠️⚠️ THE LEDGER IS OFF FOR THIS SHOP: no credit, no "Received" — online or not (review M5) ' + '─'.repeat(0));
    const off1 = await offer(br, 'Latha', ''), off2 = await offer(br, '', '98765 00001');
    say('⚠️⚠️ ledger OFF: a known customer is offered neither On credit nor Received', !off1.credit && !off1.receive && !off2.credit && !off2.receive, JSON.stringify([off1, off2]));
    const offForced = await br.evaluate(async () => { document.getElementById('cname').value = 'Latha'; rcvPayOpen();
      var d = document.getElementById('askdlg'), t = d && d.open ? d.innerText.replace(/\s+/g, ' ') : '', o = !!document.getElementById('rcvpaydlg').open;
      try { d.close(); } catch (_) {} try { document.getElementById('rcvpaydlg').close(); } catch (_) {} document.getElementById('cname').value = ''; return { said: t, open: o }; });
    say('and asking for Received anyway is refused in words, nothing opened', /Ledger is off/.test(offForced.said) && !offForced.open, offForced.said.slice(0, 70));
    L2.dead = true; await br.reload(); await shopRead(false);
    const off3 = await offer(br, 'Latha', '');
    say('ledger OFF with the line down (the kept copy): still neither', !off3.credit && !off3.receive, JSON.stringify(off3));
    L2.dead = false; L2.books = true;                        /* the owner turns the ledger on; the counter reads the shop again */
    await br.evaluate(() => refresh().catch(function(){})); await shopRead(true);
    const on1 = await offer(br, 'Latha', '');
    say('ledger ON: the same customer now gets both', on1.credit && on1.receive, JSON.stringify(on1));
    L2.dead = true; await br.reload(); await shopRead(true);
    const on2 = await offer(br, 'Latha', '');
    say('⭐ and the flag is KEPT with the snapshot: both are still there with the line down', on2.credit && on2.receive, JSON.stringify(on2));
    L2.dead = false;
    /* the line is back: open the counter afresh (its record of failed tries is per page-load, and sign-in asks
       lineUp()), then wait for a snapshot NEWER than the kept copy */
    const keptAt = await br.evaluate(() => S.at);
    await br.reload();
    await br.waitForFunction(() => typeof refresh === 'function' && typeof S !== 'undefined' && S && S.at, null, { timeout: 30000 });
    await br.evaluate(() => refresh().catch(function(){}));
    await br.waitForFunction((t) => S && S.at && S.at > t, keptAt, { timeout: 30000 });
    await signIn(pc); await signIn(br);
    /* the owner's counter PIN on the browser counter (G2's book; kind 'entity' = the owner) */
    await br.evaluate(async () => { var bk = pinBook(); bk['own-1'] = Object.assign({ id: 'own-1', kind: 'entity', name: 'Owner' }, await pinMake('4321'), { tries: 0 }); pinBookSave(bk); });

    console.log('\n── ⭐ WHO IS KNOWN, and what the counter offers ' + '─'.repeat(0));
    /* (offer() itself moved up, to the ledger-off block — the four assertions below are unchanged) */
    const o1 = await offer(br, '', ''), o2 = await offer(br, 'Mani', ''), o3 = await offer(br, 'Latha', ''), o4 = await offer(br, '', '98765 00001');
    say('a walk-in is offered no credit and no "Received"', !o1.credit && !o1.receive, JSON.stringify(o1));
    say('⚠️ two customers called Mani = nobody: no credit', !o2.credit && !o2.receive, JSON.stringify(o2));
    say('a known customer by name gets both', o3.credit && o3.receive, JSON.stringify(o3));
    say('and by phone, whatever the spacing', o4.credit && o4.receive, JSON.stringify(o4));

    /* ═══ THE LINE GOES — both counters ═══ */
    console.log('\n── ⭐⭐⭐ BOTH LINES DOWN: the day is taken offline ' + '─'.repeat(0));
    L1.dead = true; L2.dead = true;
    const doc = { C1: [], C2: [] };   /* what each counter ISSUED, by its own account */

    /* C2 — the browser counter */
    const w21 = await sell(br, { items: ['RICE', 'MILK'], pay: 'cash', tendered: 100 });
    const w22 = await sell(br, { items: ['SOAP'], pay: 'upi' });
    const w23 = await sell(br, { items: ['RICE', 'RICE'], pay: 'card' });
    const sh = { items: ['SOAP'], pay: 'cash', tendered: 20, short: 50 };
    const w25 = await sell(br, sh);
    say('⚠️ ₹20 against a ₹39 bill is NOT saved as paid — it says what is still to take', /19\.00 is still to take/.test(sh.shortSaid || '') && !sh.shortSlip && /^C2\//.test(w25),
      (sh.shortSaid || '—').slice(0, 60) + ' → then ' + w25);
    const k1 = { items: ['RICE', 'SOAP'], name: 'Kumar', phone: '9876500001', pay: 'credit' };
    const c21 = await sell(br, k1);
    say('C2 walk-ins in cash, UPI and card, numbered in C2\'s run', [w21, w22, w23].every((n) => /^C2\//.test(n)), [w21, w22, w23].join(' '));
    say('a credit sale for Kumar, within his limit, with no PIN asked', /^C2\//.test(c21), c21);
    say('⭐ the slip says ON CREDIT and "Due by" the date his terms give', /ON CREDIT/.test(k1.slip) && /Due by \d{4}-\d{2}-\d{2}/.test(k1.slip), (k1.slip.match(/ON CREDIT.{0,30}/) || ['—'])[0]);
    const limitNow = await br.evaluate(() => { document.getElementById('cphone').value = '9876500001'; PICKED = 'On credit'; paintPays();
      var t = (document.querySelector('[data-testid="till-credit-limit"]') || {}).textContent || ''; document.getElementById('cphone').value = ''; paintPays(); return t; });
    const k2 = { items: ['RICE', 'RICE', 'RICE', 'RICE', 'RICE', 'RICE', 'RICE', 'RICE', 'RICE', 'RICE', 'RICE', 'RICE', 'RICE', 'RICE', 'RICE', 'RICE'], name: 'Kumar', phone: '9876500001', pay: 'credit', pin: '1111', expectRefused: true };
    const refusedNo = await sell(br, k2);
    say('⚠️ over the limit: the owner\'s PIN is asked, with the digits, masked', /Over the credit limit/.test(k2.asked) && /limit of/.test(k2.asked) && k2.masked === 'password', k2.asked.slice(0, 110) + '… input=' + k2.masked);
    /* ₹200 owed at the snapshot + ₹91.50 given on credit THIS morning (offline) + ₹840 = ₹1,131.50 */
    say('⚠️⚠️ the limit counts the credit given offline since the snapshot', /Owes ₹291\.50 now \(₹91\.50 of it on this counter today\)/.test(k2.asked) && /₹1,131\.50/.test(k2.asked), (k2.asked.match(/Owes[^;]*;[^.]*\./) || ['—'])[0]);
    say('⚠️ a WRONG PIN makes no bill', refusedNo === '' && /did not match|wrong|left/i.test(k2.said || ''), (k2.said || '').slice(0, 70));
    await br.evaluate(() => { try { document.querySelectorAll('dialog[open]').forEach(function(d){ d.close(); }); } catch (_) {} });
    const k3 = { items: [], name: 'Kumar', phone: '9876500001', pay: 'credit', pin: '4321' };   /* the same cart, still on screen */
    const c22 = await sell(br, k3);
    say('the owner\'s PIN allows it — the bill is made', /^C2\//.test(c22), c22);
    const r21 = await returnAll(br, w21);
    say('a return of a walk-in bill, in the credit-note run', /C/.test(r21) && r21 !== w21, r21);
    const p21o = { phone: '9876500001', amount: 100, mode: 'cash' };
    const p21 = await receivePay(br, p21o);
    say('⭐ the proposal is shown BEFORE saving: oldest due first, the shop confirms', /OLD\/0001/.test(p21o.proposal) && /shop/.test(p21o.proposal), p21o.proposal.slice(0, 90));
    say('money received from Kumar, numbered R/… — never the sales run', /^R\/C2\//.test(p21), p21);
    const chq0 = { phone: '9876500001', amount: 50, mode: 'cheque', cheque: { no: '', bank: 'SBI' } };
    const pNone = await receivePay(br, chq0);
    say('⚠️ a cheque with no number is refused, nothing recorded', pNone === '' && /number/.test(chq0.said), chq0.said.slice(0, 60));
    const chq1 = { phone: '9876500001', amount: 50, mode: 'cheque', cheque: { no: '004512', bank: 'SBI' } };
    const p22 = await receivePay(br, chq1);
    say('a cheque WITH its number is recorded, "received, not cleared"', /^R\/C2\//.test(p22) && /applied when it clears/.test(chq1.proposal) && /not cleared/.test(chq1.note), p22 || (chq1.said + ' | ' + chq1.note));

    /* ⚠️⚠️ review F4: the line returns, the SNAPSHOT is read again, and the queue has not gone yet (no chit gets through) */
    const owedOf = (p, id) => p.evaluate(async (id) => { var c = (S.customers || []).filter(function(x){ return x.identity_id === id; })[0];
      var since = await creditSinceRefresh(c), k = creditLimitCheck(c, 0); return { since: since, owed: k.owed, at: S.at }; }, id);
    const atWas = await br.evaluate(() => S.at);
    L2.hold = true; L2.dead = false;
    await br.evaluate(() => refresh().catch(function(){}));
    await br.waitForFunction((t) => S && S.at && S.at > t, atWas, { timeout: 30000 });
    const f4 = await owedOf(br, 'id-kumar'), f4q = await br.evaluate(async () => (await DB.all('queue')).length);
    L2.dead = true; L2.hold = false;
    /* ₹200 at the snapshot (the server has seen none of today's bills) + ₹91.50 + ₹840 still in the queue */
    say('⚠️⚠️ a NEWER snapshot does not hide the credit bills still waiting to be sent', f4q >= 2 && Math.round(f4.owed * 100) === 113150 && Math.round(f4.since * 100) === 93150 && LEDGER.kept.size === 0,
      'owes ₹' + f4.owed + ' (₹' + f4.since + ' unsent) · queue ' + f4q + ' · snapshot ' + String(f4.at).slice(11, 19) + ' > ' + String(atWas).slice(11, 19));

    /* C1 — the shop PC */
    const w11 = await sell(pc, { items: ['RICE'], pay: 'cash', tendered: 60 });
    const w12 = await sell(pc, { items: ['SOAP', 'MILK'], pay: 'upi' });
    const lt = { items: ['MILK', 'MILK'], name: 'Latha', phone: '9876500002', pay: 'credit' };
    const c11 = await sell(pc, lt);
    say('C1 (the shop PC) walk-ins, numbered in C1\'s run', [w11, w12].every((n) => /^C1\//.test(n)), [w11, w12].join(' '));
    say('credit for Latha, whose terms the shop never set: "shop\'s terms", no invented date', /^C1\//.test(c11) && /ON CREDIT/.test(lt.slip) && !/Due by/.test(lt.slip), (lt.slip.match(/ON CREDIT.{0,20}/) || ['—'])[0]);
    /* ⭐ the Today sheet SEGREGATES the bills by tender (Athi, 2026-10-01): each row says how it was paid, the
       totals are chips that filter, and "view" brings the bill up with Print on it */
    await pc.evaluate(() => { TODAY_HOW = ''; return openBills(); });
    await pc.waitForSelector('[data-testid="till-bill-how-' + c11 + '"]', { timeout: 15000 });
    const howOf = async (no) => (await pc.textContent('[data-testid="till-bill-how-' + no + '"]').catch(() => '')).trim();
    say('every row says how it was paid: cash · UPI · on credit', (await howOf(w11)) === 'Cash' && (await howOf(w12)) === 'UPI' && (await howOf(c11)) === 'On credit', [await howOf(w11), await howOf(w12), await howOf(c11)].join(' / '));
    say('the totals are chips, one per tender', await pc.locator('[data-testid="till-today-how-on-credit"]').count() === 1 && await pc.locator('[data-testid="till-today-how-cash"]').count() === 1, 'chips');
    await pc.click('[data-testid="till-today-how-on-credit"]');
    await pc.waitForSelector('[data-testid="till-today-how-on"]', { timeout: 10000 });
    say('tap "On credit" → only the credit bills are listed', await pc.locator('[data-testid="till-bill-view-' + c11 + '"]').count() === 1 && await pc.locator('[data-testid="till-bill-view-' + w11 + '"]').count() === 0, 'filtered');
    await pc.click('[data-testid="till-today-how-on-credit"]');
    await pc.waitForSelector('[data-testid="till-bill-view-' + w11 + '"]', { timeout: 10000 });
    say('tap it again → every bill is back, and the row says "view", not "print"', (await pc.textContent('[data-testid="till-bill-view-' + w11 + '"]')).trim() === 'view', 'view');
    await pc.click('[data-testid="till-bill-view-' + w11 + '"]');
    await pc.waitForFunction(() => { var d = document.getElementById('slipdlg'); return d && d.open; }, null, { timeout: 10000 });
    say('"view" brings the bill up, with Print on the bill itself', /Print/.test(await pc.evaluate(() => (document.getElementById('slipdlg') || {}).innerText || '')), 'bill shown');
    await closeSlip(pc);
    await pc.evaluate(() => { try { document.querySelectorAll('dialog[open]').forEach(function(d){ d.close(); }); } catch (_) {} });
    const r11 = await returnAll(pc, w12);
    say('a return on the shop PC', /^CN\/C1\//.test(r11), r11);
    await pc.evaluate(() => expOpen());
    /* the sheet repaints once after opening; a fill that lands before that repaint is lost and the button stays
       disabled (seen 1 run in 2 on 2026-09-30) — fill until the button is live, then press it */
    for (let i = 0; i < 5; i++) {
      await pc.fill('#expamt', '20'); await pc.fill('#expwhat', 'Delivery boy');
      if (await pc.evaluate(() => !document.getElementById('expgo').disabled)) break;
      await pc.waitForTimeout(200);
    }
    await pc.click('[data-testid="till-expense-go"]');
    await pc.waitForSelector('#askdlg[open]', { timeout: 10000 }); await pc.click('#askok');
    await pc.waitForSelector('[data-testid="till-expense-done"]', { timeout: 15000 });
    await pc.evaluate(() => { try { document.getElementById('expdlg').close(); } catch (_) {} });
    const p11o = { phone: '9876500001', amount: 30, mode: 'upi' };
    const p11 = await receivePay(pc, p11o);
    say('money received on the shop PC: the program\'s own R series', /^R\/C1\//.test(p11), p11);
    /* the same on the shop PC: its program reads the shop again with the queue still full — Latha's bill is unsent */
    const at1 = await pc.evaluate(() => S.at);
    L1.hold = true; L1.dead = false;
    await fetch('http://127.0.0.1:' + PORT + '/api/refresh', { method: 'POST' }).catch(() => {});
    await pc.evaluate(() => refresh().catch(function(){}));
    await pc.waitForFunction((t) => S && S.at && S.at > t, at1, { timeout: 30000 });
    const f4pc = await owedOf(pc, 'id-latha');
    L1.dead = true; L1.hold = false;
    say('⚠️⚠️ and on the shop PC: the program\'s unsent credit bill still counts after a newer snapshot', Math.round(f4pc.since * 100) === 5400 && LEDGER.kept.size === 0, '₹' + f4pc.since + ' unsent for Latha');
    await pc.screenshot({ path: path.join(SHOTS, '1-c1-offline.png') });
    await br.screenshot({ path: path.join(SHOTS, '1-c2-offline.png') });

    /* nothing has reached the server */
    say('nothing reached the server while the lines were down', LEDGER.kept.size === 0, 'kept=' + LEDGER.kept.size);

    /* ═══ THE SHOP PC DIES MID-QUEUE, AND COMES BACK ═══ */
    console.log('\n── ⭐⭐ THE SHOP PC IS KILLED WITH A FULL QUEUE, AND RESTARTED ' + '─'.repeat(0));
    const q1 = (await pcState()).queued;
    const pid = proc.pid;
    proc.kill();                                             /* ⚠️ only the PID this harness started */
    await new Promise((res) => proc.once('exit', res));
    startPC();
    for (let i = 0; i < 100 && !(await pcState()); i++) await sleep(150);
    const q2 = (await pcState()).queued;
    say('the queue survived the restart, every row', q1 >= 6 && q2 === q1, 'before=' + q1 + ' after=' + q2 + ' (pid ' + pid + ' → ' + proc.pid + ')');

    /* what each counter says it issued — read from its OWN record, before anything is sent */
    const c1Bills = (await fetch('http://127.0.0.1:' + PORT + '/api/bills?days=2').then((x) => x.json())).bills || [];
    const c1Dir = (function find(d) { for (const n of fs.readdirSync(d)) { const f = path.join(d, n); if (fs.statSync(f).isDirectory()) { const r = find(f); if (r) return r; } else if (/^queue\.jsonl$/.test(n)) return d; } return null; })(path.join(home, 'till-data'));
    const c1Docs = fs.existsSync(path.join(c1Dir, 'docs-' + TODAY + '.jsonl')) ? fs.readFileSync(path.join(c1Dir, 'docs-' + TODAY + '.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    say('the shop PC filed the payment with the day\'s documents, NOT its bills', c1Docs.some((d) => d.no === p11) && !c1Bills.some((x) => x.no === p11), 'docs: ' + c1Docs.map((d) => d.no).join(' '));
    const c2Local = await br.evaluate(async () => ({ bills: await DB.all('bills'), pays: (await DB.get('payments-' + new Date().toISOString().slice(0, 10))) || [] }));
    say('the browser kept the payments in their own list, NOT its bills', c2Local.pays.length === 2 && !c2Local.bills.some((x) => /^R\//.test(x.no)), c2Local.pays.map((x) => x.no).join(' '));
    doc.C1 = c1Bills.map((x) => x.no).concat(c1Docs.map((d) => d.no));
    doc.C2 = c2Local.bills.map((x) => x.no).concat(c2Local.pays.map((x) => x.no));

    /* ═══ THE LINE COMES BACK — LOSSY ═══ */
    console.log('\n── ⭐⭐⭐ THE LINES COME BACK, AND DROP ANSWERS: the server keeps a chit, the counter never hears ' + '─'.repeat(0));
    L1.dead = false; L2.dead = false; L1.lossy = 2; L2.lossy = 2;
    const drainAll = async () => {
      for (let i = 0; i < 60; i++) {
        await fetch('http://127.0.0.1:' + PORT + '/api/send', { method: 'POST' }).catch(() => {});
        /* the browser's own recovery path: a re-read proves the line (lineUp), then the queue goes — ignoring the backoff */
        await br.evaluate(async () => { try { await refresh(); } catch (_) {} if (HOST.drain) await HOST.drain({ force: true }); }).catch(() => {});
        await sleep(400);
        const a = (await pcState()) || {}, bq = await br.evaluate(async () => (await DB.all('queue')).length);
        if (!a.queued && !bq) return { c1: 0, c2: 0 };
      }
      return { c1: ((await pcState()) || {}).queued, c2: await br.evaluate(async () => (await DB.all('queue')).length) };
    };
    const left = await drainAll();
    say('both queues emptied', left.c1 === 0 && left.c2 === 0, JSON.stringify(left));
    say('the lost answers were real — the server kept chits the counters never heard about', L1.lost === 2 && L2.lost === 2, 'lost C1=' + L1.lost + ' C2=' + L2.lost);
    const issued = doc.C1.concat(doc.C2);
    const keptRefs = [...LEDGER.kept.keys()];
    const missing = issued.filter((n) => !LEDGER.kept.has(n)), stray = keptRefs.filter((n) => issued.indexOf(n) < 0);
    say('⭐⭐⭐ EVERY document the counters issued reached the server', missing.length === 0, issued.length + ' issued · missing ' + (missing.join(' ') || 'none'));
    say('and nothing the counters did not issue', stray.length === 0, 'stray ' + (stray.join(' ') || 'none'));
    say('⭐⭐⭐ EXACTLY ONCE: every resend was absorbed by client_ref', LEDGER.duplicates >= 4 && (LEDGER.extra || []).length === 0, 'arrivals ' + LEDGER.arrivals.length + ' · kept ' + LEDGER.kept.size + ' · duplicates absorbed ' + LEDGER.duplicates);
    const shared = doc.C1.filter((n) => doc.C2.indexOf(n) >= 0);
    say('⭐ two counters, no collision: no number issued by both', shared.length === 0 && new Set(issued).size === issued.length, 'C1 ' + doc.C1.length + ' · C2 ' + doc.C2.length + ' · shared ' + shared.length);
    const kc = LEDGER.kept.get(c21) || {};
    say('the credit chit carries WHO (identity_id), the terms and the due date', kc.business_json && kc.business_json.customer.identity_id === 'id-kumar'
      && kc.business_json.terms && /^\d{4}-\d{2}-\d{2}$/.test(kc.business_json.terms.due_date) && kc.business_json.terms.credit_days === 15, JSON.stringify(kc.business_json && kc.business_json.terms));
    const ko = LEDGER.kept.get(c22) || {};
    say('the over-limit bill carries the owner\'s override, on the record', ko.business_json && ko.business_json.credit_override && ko.business_json.credit_override.by.id === 'own-1', JSON.stringify(ko.business_json && ko.business_json.credit_override && { by: ko.business_json.credit_override.by.name, limit: ko.business_json.credit_override.limit, after: ko.business_json.credit_override.after }));
    const kw = LEDGER.kept.get(w21) || {};
    say('a walk-in chit names nobody', kw.business_json && !kw.business_json.customer.identity_id && !kw.business_json.terms, JSON.stringify(kw.business_json && kw.business_json.customer));

    /* ═══ DAY CLOSE ═══ */
    console.log('\n── ⭐⭐ DAY CLOSE, then a LATE bill ' + '─'.repeat(0));
    const e1 = dayClose('C1', TODAY), e2 = dayClose('C2', TODAY);
    const frozen = JSON.stringify(LEDGER.entries);
    /* the late bill: C2 goes down again, sells, comes back after the close */
    L2.dead = true;
    const w24 = await sell(br, { items: ['MILK'], pay: 'cash', tendered: 50 });
    L2.dead = false;
    await drainAll();
    const late = settleLate();
    say('the late bill arrived once', LEDGER.kept.has(w24), w24);
    say('⭐⭐ it became a SUPPLEMENTARY entry', late.length === 1 && late[0].supplementary && late[0].bills.length === 1 && late[0].bills[0] === w24, late.map((e) => e.source_ref).join(' ') || 'none');
    say('⚠️⚠️ and the closed entries were NOT edited', JSON.stringify(LEDGER.entries.slice(0, JSON.parse(frozen).length)) === frozen, 'closed entries byte-identical');
    doc.C2.push(w24);

    /* ═══ REPLAY ═══ */
    console.log('\n── ⭐⭐ REPLAY: every chit sent again, from both sides ' + '─'.repeat(0));
    const before = { kept: LEDGER.kept.size, entries: JSON.stringify(LEDGER.entries), dup: LEDGER.duplicates };
    await br.evaluate(async () => { var bs = await DB.all('bills'); for (var i = 0; i < bs.length; i++) await DB.put('queue', bs[i]);
      var pays = (await DB.get('payments-' + new Date().toISOString().slice(0, 10))) || [];
      for (var j = 0; j < pays.length; j++) await DB.put('queue', { no: pays[j].no, at: pays[j].at, kind: 'payment', chitBody: pays[j].chitBody }); });
    await drainAll();
    for (const c of [...LEDGER.kept.values()].filter((x) => counterOf(x) === 'C1')) {
      const body = Object.assign({}, c); delete body._id;
      await fetch('http://127.0.0.1:' + L1.server.address().port + '/api/chits/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    }
    settleLate();
    say('⭐⭐ the replay changed nothing: same chits, same postings', LEDGER.kept.size === before.kept && JSON.stringify(LEDGER.entries) === before.entries,
      'kept ' + before.kept + '→' + LEDGER.kept.size + ' · entries ' + JSON.parse(before.entries).length + '→' + LEDGER.entries.length + ' · resends absorbed ' + (LEDGER.duplicates - before.dup));

    /* ═══ THE NUMBERS ═══ */
    console.log('\n── ⭐⭐⭐ THE POSTINGS, TO THE PAISA ' + '─'.repeat(0));
    const unbalanced = LEDGER.entries.filter((e) => !POSTING.balanced(e.lines, 'INR'));
    let dr = 0, cr = 0; LEDGER.entries.forEach((e) => e.lines.forEach((l) => { dr += P(l.dr); cr += P(l.cr); }));
    say('every entry balances, debit = credit to the paisa', unbalanced.length === 0 && LEDGER.entries.length > 0, LEDGER.entries.length + ' entries · unbalanced ' + unbalanced.length);
    say('the whole day balances', dr === cr, 'Dr ₹' + R(dr) + ' = Cr ₹' + R(cr));
    const unexpected = LEDGER.refused.filter((x) => !/cheque/i.test(x.why));
    say('nothing was refused by the engine except what must wait', unexpected.length === 0, LEDGER.refused.map((x) => x.ref + ': ' + x.why.slice(0, 50)).join(' | ') || 'none');
    say('the cheque is HELD, not posted (C3)', LEDGER.held.length === 1 && LEDGER.held[0] === p22 && !LEDGER.entries.some((e) => e.source_ref === p22), 'held ' + LEDGER.held.join(' '));
    /* each source posted once */
    const srcs = LEDGER.entries.map((e) => e.source_ref);
    const twice = srcs.filter((s, i) => srcs.indexOf(s) !== i);
    const inWalkin = []; LEDGER.entries.filter((e) => e.type === 'walkin_day').forEach((e) => (e.bills || []).forEach((x) => inWalkin.push(x)));
    const twiceW = inWalkin.filter((s, i) => inWalkin.indexOf(s) !== i);
    say('⭐⭐⭐ no source posted twice (bill, payment, return, expense, walk-in)', twice.length === 0 && twiceW.length === 0, 'twice: ' + (twice.concat(twiceW).join(' ') || 'none'));

    /* the walk-in day = the sum of the counters' OWN bills, per mode — read from their records, not from the server */
    const c1Now = (await fetch('http://127.0.0.1:' + PORT + '/api/bills?days=2').then((x) => x.json())).bills || [];
    const c2Now = await br.evaluate(async () => await DB.all('bills'));
    const walkSum = (bills) => { const m = {}; bills.filter((x) => !x.kind || x.kind === 'cash' || x.kind === 'tax_invoice' || x.kind === 'bill_of_supply' || (x.payments && !/credit_note|expense/.test(x.kind)))
      .filter((x) => !/^(CN|EXP|C|E)\//.test(String(x.no)) && x.kind !== 'credit_note' && x.kind !== 'expense' && !x.terms && !(x.payments || []).some((y) => modeOf(y.how) === 'credit'))
      .forEach((x) => (x.payments || []).forEach((y) => { const k = modeOf(y.how); m[k] = (m[k] || 0) + P(y.amount); })); return m; };
    const postedSum = (counter) => { const m = {}; LEDGER.entries.filter((e) => e.type === 'walkin_day' && e.counter === counter)
      .forEach((e) => e.lines.forEach((l) => { if (POSTING.MODE_ACCOUNT[l.account] || l.account === 'bank') m[l.account] = (m[l.account] || 0) + P(l.dr) - P(l.cr); })); return m; };
    for (const [counter, bills] of [['C1', c1Now], ['C2', c2Now]]) {
      const own = walkSum(bills), posted = postedSum(counter);
      const keys = [...new Set(Object.keys(own).concat(Object.keys(posted)))].filter((k) => (own[k] || 0) || (posted[k] || 0));
      say('⭐⭐⭐ ' + counter + ': the walk-in entries = the sum of its own bills, per mode', keys.length > 0 && keys.every((k) => (own[k] || 0) === (posted[k] || 0)),
        keys.map((k) => k + ' ' + R(own[k] || 0) + '/' + R(posted[k] || 0)).join(' · '));
    }
    const ro = LEDGER.entries.reduce((a, e) => a + e.lines.filter((l) => l.account === 'round_off').reduce((s, l) => s + P(l.cr) - P(l.dr), 0), 0);
    const roBy = LEDGER.entries.map((e) => [e.source_ref, e.lines.filter((l) => l.account === 'round_off').reduce((s, l) => s + P(l.cr) - P(l.dr), 0)]).filter((x) => x[1]);
    if (process.env.SHOW_LOG) [...LEDGER.kept.values()].filter(isSale).forEach((c) => console.log('    ' + c.client_ref + ' parts ' + JSON.stringify(c.business_json.payment.parts) + ' lines ' + JSON.stringify(c.line_items.map((l) => [l.particulars, l.quantity, l.price, l.total]))));
    say('the tax split rounds by paisa, not rupees', Math.abs(ro) <= LEDGER.entries.length, 'round-off in total ₹' + R(ro) + ' ' + JSON.stringify(roBy));
    const rets = LEDGER.entries.filter((e) => e.type === 'return');
    say('each refund equals its credit note\'s lines', rets.length === 2 && rets.every((e) => e.refund_minor === e.lines_minor), rets.map((e) => e.source_ref + ' ' + R(e.refund_minor) + '/' + R(e.lines_minor)).join(' · '));

    /* Kumar's account: credit given − money received (cleared) — from the counters' documents, against the postings */
    const credOf = (no) => { const c = LEDGER.kept.get(no); return (c.business_json.payment.parts || []).filter((x) => modeOf(x.how) === 'credit').reduce((a, x) => a + P(x.amount), 0); };
    const wantK = credOf(c21) + credOf(c22) - P(100) - P(30);
    const gotK = LEDGER.entries.reduce((a, e) => a + e.lines.filter((l) => l.account === 'debtors' && l.party === 'id-kumar').reduce((s, l) => s + P(l.dr) - P(l.cr), 0), 0);
    say('⭐⭐ Kumar\'s account moved by credit given less money received (cheque held)', gotK === wantK, '₹' + R(gotK) + ' (want ₹' + R(wantK) + ')');
    const gotL = LEDGER.entries.reduce((a, e) => a + e.lines.filter((l) => l.account === 'debtors' && l.party === 'id-latha').reduce((s, l) => s + P(l.dr) - P(l.cr), 0), 0);
    say('Latha\'s account = her credit bill', gotL === credOf(c11), '₹' + R(gotL));

    console.log('\n  THE NUMBERS: ' + issued.length + ' + 1 late documents from 2 counters · ' + LEDGER.arrivals.length + ' arrivals · ' + LEDGER.kept.size
      + ' kept · ' + LEDGER.duplicates + ' duplicates absorbed · ' + LEDGER.entries.length + ' entries (' + LEDGER.entries.filter((e) => e.supplementary).length
      + ' supplementary) · Dr ₹' + R(dr) + ' = Cr ₹' + R(cr) + ' · 1 cheque held');
    const pe = errs.filter((e) => !/favicon|ERR_|Failed to fetch|NetworkError|net::/.test(e));
    say('no page errors on either counter', pe.length === 0, pe.slice(0, 2).join(' | ') || 'none');
  } catch (e) {
    bad++; console.log('  ✗ ' + (e && e.stack || e));
    try { await pc.screenshot({ path: path.join(SHOTS, 'x-c1.png') }); await br.screenshot({ path: path.join(SHOTS, 'x-c2.png') }); } catch (_) {}
  } finally {
    await b.close().catch(() => {});
    try { proc.kill(); } catch (_) {}
    L1.server.close(); L2.server.close(); web.close();
    try { fs.rmSync(home, { recursive: true, force: true }); } catch (_) {}
  }
  if (bad && process.env.SHOW_LOG) console.log(out.slice(-3000));
  console.log('\n' + (bad ? '✗ ' + bad + ' FAILED' : '✓ ALL PASSED') + (BREAK ? '   (BREAK=' + BREAK + ' — a failure here is the guard WORKING)' : ''));
  process.exit(bad ? 1 : 0);
})();
