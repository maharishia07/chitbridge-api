/**
 * books-todo.test.cjs — THE TO-DO FEED FOR CB ACCOUNTS' HOME (GET /api/books/todo) THROUGH REAL EXPRESS, with a stand-in auth, db, store and template table.
 *
 * Every row comes from a real check of the books and carries its button: supplier bills waiting to be accepted · months over but not locked · closing
 * stock missing · GST to close (with the due date from gst-returns.dueDate) · repeating entries due · accruals due to turn back · a year that can be
 * closed. A kind with nothing to do is LEFT OUT — and each one disappears when the thing is done. Run: node tests/books-todo.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Mayur Bhavan' };
const authStub = Object.assign((req, res, next) => { req.identity = OWNER; next(); }, {
  entityOf: (req) => req.identity.identity_id,
  requireScope: () => (req, res, next) => next(),
});
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = []; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});
function memoryTemplates() {
  const rows = []; let seq = 0; const m = { rows };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  m.store = {
    async exists() { return true; },
    async list(h, e) { return clone(rows.filter((r) => r.entity === e)); },
    async get(h, e, id) { const r = rows.find((x) => x.entity === e && x.recurring_id === id); return r ? clone(r) : null; },
    async insert(h, e, t) { const r = { entity: e, recurring_id: '66666666-6666-4666-8666-' + String(++seq).padStart(12, '0'), name: t.name, event: clone(t.event), frequency: t.frequency, next_on: t.next_on,
      anchor_day: t.anchor_day, end_on: t.end_on || null, auto: !!t.auto, active: t.active !== false, last_done_on: null, created_by: t.created_by || null }; rows.push(r); return clone(r); },
    async update(h, e, id, p) { const r = rows.find((x) => x.entity === e && x.recurring_id === id); if (!r) return null; Object.assign(r, clone(p)); return clone(r); },
  };
  return m;
}

(async () => {
  console.log('\n══ /api/books/todo — the To-do feed ══\n');
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const R = require(path.join(H.API, 'lib', 'books-recurring'));
  const BP = require(path.join(H.API, 'lib', 'books-period'));
  const mem = memoryTemplates(); R.use(mem.store);
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/books' + p, b);
  let DAY = '2026-11-05'; const realDay = K.dayOf;
  K.dayOf = (ts, c) => (ts instanceof Date && Math.abs(ts.getTime() - Date.now()) < 5000 ? DAY : realDay(ts, c));
  const todo = async () => { const r = await q('GET', '/todo'); return r.status === 200 && Array.isArray(r.body) ? r.body : null; };
  const kinds = (t) => (t || []).map((x) => x.kind);
  const get = (t, k) => (t || []).find((x) => x.kind === k);

  await X.store.saveSetting(X.db, SHOP, { enabled: false });
  ok('the ledger is on', (await q('POST', '/enable', {})).body.ok === true);
  X.T.parties.push({ owner: SHOP, party_id: CUST, party_no: 'P-00001', name: 'Ravi Stores', customer: true, credit_days: 10 });
  X.T.setting.get(SHOP).enabled_at = '2026-04-01T04:00:00.000Z';   /* the ledger on since April (FX-UX1: the month-lock to-do starts at the ledger's month) */
  const S = await X.B.settingOf(X.db, SHOP);
  const sale = (date, ref) => X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date, currency: 'INR', party: CUST, source_ref: ref, by_rate: [{ rate: 18, taxable: 1000, cgst: 90, sgst: 90, igst: 0 }], paid: { cash: 1180 }, round_off: 0 });
  await sale('2026-08-05', 'chit:aug'); await sale('2026-09-05', 'chit:sep'); await sale('2026-10-05', 'chit:oct');

  DAY = '2026-04-20'; const none = await todo(); DAY = '2026-11-05';
  ok('in April, with nothing over and nothing waiting, the feed is an empty list (only a failing thing earns a row)', Array.isArray(none) && none.length === 0, JSON.stringify(none));

  /* a supplier bill waiting for acceptance, a repeating entry due, an accrual to turn back */
  await X.store.queue(X.db, SHOP, { source_chit_id: null, source_ref: 'chit:bill1', event: { job: 'chit', chit_id: 'bill1', waiting: 'acceptance' }, why: 'Waiting for you to confirm the goods (bill 7 from Kumar Traders)' });
  await X.store.queue(X.db, SHOP, { source_chit_id: null, source_ref: 'chit:rcpt1', event: { job: 'chit', chit_id: 'rcpt1', waiting: 'party' }, why: 'Who is Sri Ganesh? Add them as a supplier — then bill SG-102 waits for you to accept it.' });
  await X.store.queue(X.db, SHOP, { source_chit_id: null, source_ref: 'chit:bill2', event: { job: 'chit', chit_id: 'bill2', waiting: 'dispute' }, why: 'Disputed' });
  const rec = await q('POST', '/recurring', { name: 'Shop rent', event: { kind: 'expense', class: 'rent', amount: 5000, how: 'bank' }, frequency: 'monthly', next_on: '2026-11-01' });
  DAY = '2026-09-30';
  await BP.accrue(SHOP, S, { ref: 'ELEC-9', kind: 'outstanding', class: 'electricity', amount: 1200, date: '2026-09-30' }, SHOP);
  DAY = '2026-11-05';

  const t1 = await todo();
  ok('GET /todo → an array of { kind, count, words, action }', Array.isArray(t1) && t1.length > 0 && t1.every((x) => x.kind && x.count > 0 && typeof x.words === 'string' && x.action && x.action.label && x.action.screen && x.action.call), JSON.stringify(t1).slice(0, 300));
  ok('every kind this shop needs is there: ' + kinds(t1).join(', '), ['bills_to_accept', 'months_not_locked', 'closing_stock_missing', 'gst_due', 'recurring_due', 'accrual_reversals_due'].every((k) => kinds(t1).indexOf(k) >= 0), JSON.stringify(kinds(t1)));
  ok('…and no year can be closed yet (the year is running)', kinds(t1).indexOf('year_close_possible') < 0);
  ok('FX-F10W · a bill naming a supplier the books do not know is its own row (suppliers_to_add), never "to accept"', get(t1, 'suppliers_to_add') && get(t1, 'suppliers_to_add').count === 1 && get(t1, 'suppliers_to_add').action.screen === 'waiting', JSON.stringify(get(t1, 'suppliers_to_add')));
  ok('bills to accept counts ONLY the ones waiting on acceptance (a disputed one is not "accept")', get(t1, 'bills_to_accept').count === 1 && /1 supplier bill is waiting/.test(get(t1, 'bills_to_accept').words), JSON.stringify(get(t1, 'bills_to_accept')));
  const ml = get(t1, 'months_not_locked');
  ok('months not locked: April to October are over and open (7), named in words', ml.count === 7 && /April 2026/.test(ml.words) && /and more/.test(ml.words) && ml.items.length === 7, JSON.stringify(ml));
  X.T.setting.get(SHOP).enabled_at = '2026-10-13T04:00:00.000Z';
  const late = get(await todo(), 'months_not_locked');
  X.T.setting.get(SHOP).enabled_at = '2026-04-01T04:00:00.000Z';
  ok('FX-UX1: a ledger switched on in October → only October is a month to lock (April–September had no books; never shown as work)', late && late.count === 1 && late.items[0].month === '2026-10' && !/April|September/.test(late.words), JSON.stringify(late));
  const gd = get(t1, 'gst_due');
  ok('GST due: the output tax of three months stands unpaid; the row is for October (the last month over), due the 20th of the next month (gst-returns.dueDate), not yet past',
    gd.count === 1 && gd.items[0].month === '2026-10' && gd.items[0].due === '2026-11-20' && gd.items[0].overdue === false && gd.items[0].owed_minor === 3 * 18000 && /20 Nov/.test(gd.words), JSON.stringify(gd));
  ok('closing stock is missing for October (the last month over, with activity)', get(t1, 'closing_stock_missing').items[0].date === '2026-10-31', JSON.stringify(get(t1, 'closing_stock_missing')));
  ok('recurring due names the template; the accrual reversal names its reference', get(t1, 'recurring_due').items[0].name === 'Shop rent' && get(t1, 'accrual_reversals_due').items[0].ref === 'ELEC-9', JSON.stringify([get(t1, 'recurring_due'), get(t1, 'accrual_reversals_due')]));

  /* F5 A1 · bills_unrated: a sale bill in the books whose line nobody rated — listed for a shop that CHARGES its tax, never changed; a composition shop lists none */
  ok('no registration facts yet (identities row unknown) → the shop charges none → no "bills unrated" row, even with unrated bills about', kinds(t1).indexOf('bills_unrated') < 0);
  X.T.identities.push({ identity_id: SHOP, display_name: 'Mayur Bhavan', gstn: '33AAAAA0000A1Z5', country: 'IN', policy_flags: { gst_registration: 'regular' } });
  X.T.chits.push(
    /* ACC-203: a counter bill is a self chit and keeps the copy its self-copy policy names — 'received' by default (bill-70), or BOTH (bill-73): one row each */
    { chit_id: 'bill-70', entity_id: SHOP, direction: 'received', business_json: { printed_as: 'C1/26-27/0070', till: { id: 'C1' } }, line_items: [{ name: 'Veg Meals', qty: 1, price: 120 }, { name: 'Water', qty: 1, price: 20, gst_rate: 18 }] },
    { chit_id: 'bill-73', entity_id: SHOP, direction: 'sent', business_json: { printed_as: 'C1/26-27/0073' }, line_items: [{ name: 'Payasam', qty: 1, price: 50 }] },
    { chit_id: 'bill-73', entity_id: SHOP, direction: 'received', business_json: { printed_as: 'C1/26-27/0073' }, line_items: [{ name: 'Payasam', qty: 1, price: 50 }] },
    { chit_id: 'bill-71', entity_id: SHOP, direction: 'sent', business_json: { printed_as: 'C1/26-27/0071' }, line_items: [{ name: 'Water', qty: 1, price: 20, gst_rate: 18 }] },
    { chit_id: 'bill-72', entity_id: SHOP, direction: 'sent', business_json: { printed_as: 'C1/26-27/0072' }, line_items: [{ name: 'Exempt thing', qty: 1, price: 10, gst_rate: 0 }] });
  /* bill-71 to a known party posts as its own sale_bill (a 0-rated by_rate so the GST figures above do not move); bill-70 and bill-72 are walk-ins: the DAY entry names them (source_chit_ids) — the twin holds that row as the writer would */
  await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-10-08', currency: 'INR', party: CUST, source_ref: 'chit:bill-71', source_chit_id: 'bill-71', by_rate: [{ rate: 0, taxable: 20, cgst: 0, sgst: 0, igst: 0 }], paid: { cash: 20 }, round_off: 0 });
  X.T.entries.push({ entry_id: 'wd-1', entity_id: SHOP, entry_no: 9001, posting_date: '2026-10-09', event_type: 'walkin_day', source_ref: 'bill:day-9', source_chit_ids: ['bill-72', 'bill-70'] });
  X.T.entries.push({ entry_id: 'wd-2', entity_id: SHOP, entry_no: 9002, posting_date: '2026-10-10', event_type: 'walkin_day', source_ref: 'bill:day-10', source_chit_ids: ['bill-70', 'bill-73'] }); /* bill-70 named twice (a late bill re-covered): still one row; bill-73 keeps both copies: still one row */
  const chitsBefore = JSON.stringify(X.T.chits), entriesBefore = X.T.entries.length;
  const ur = get(await todo(), 'bills_unrated');
  const b70 = ur && ur.items.find((i) => i.chit_id === 'bill-70'), b73 = ur ? ur.items.filter((i) => i.chit_id === 'bill-73') : [];
  ok('a registered shop: the TWO bills with an unrated line are listed once each (however many entries or copies name them: bill-70 a received self copy in two entries, bill-73 both copies), by printed number, with how many of their lines; a rated bill and a real 0% are not listed',
    ur && ur.count === 2 && ur.items.length === 2 && b73.length === 1 && b70 && b70.ref === 'C1/26-27/0070' && b70.unrated_lines === 1 && b70.lines === 2 && b70.date === '2026-10-10', JSON.stringify(ur));
  ok('…in the pack’s words (GST, never typed), saying the bills stay as issued and the CA decides; the row carries its button', ur && /^2 bills have a line with no GST rate\. The bills stay as issued/.test(ur.words) && ur.action.screen === 'gst', JSON.stringify(ur && ur.words));
  ok('the check is a READ: no chit and no entry changed', JSON.stringify(X.T.chits) === chitsBefore && X.T.entries.length === entriesBefore);
  X.T.identities[X.T.identities.length - 1].policy_flags.gst_registration = 'composition';
  ok('a composition shop (same GSTIN) charges none → lists none — the gate is tax-shelf.chargesTax, never "has a GSTIN"', kinds(await todo()).indexOf('bills_unrated') < 0);
  X.T.identities[X.T.identities.length - 1].policy_flags.gst_registration = 'regular';
  X.T.chits.filter((c) => c.chit_id === 'bill-70' || c.chit_id === 'bill-73').forEach((c) => { c.line_items[0].gst_rate = 5; }); /* both copies of bill-73 */
  ok('once the bill’s line carries a rate, the row is gone', kinds(await todo()).indexOf('bills_unrated') < 0);

  /* each one goes when the thing is done */
  /* STD1: ONE count — 205 more bills to accept (as park writes them: todo on the event) → the row says 206, never the 200-row page's count */
  for (let i = 0; i < 205; i++) await X.store.queue(X.db, SHOP, { source_chit_id: null, source_ref: 'chit:many' + i, event: { job: 'chit', chit_id: 'many' + i, waiting: 'acceptance', todo: 'accept' }, why: 'Waiting for you to confirm the goods (bill M' + i + ')' });
  const many = get(await todo(), 'bills_to_accept');
  ok('STD1 · > 200 rows: the count is the one count (books-store waitingCount, every open row) — 206, the same number Home and /health say',
    many && many.count === 206 && /^206 supplier bills are waiting/.test(many.words) && (await X.store.waitingCount(X.db, SHOP)).accept === 206, JSON.stringify(many && [many.count, many.words]));
  X.T.outbox.forEach((o) => { if (/^chit:many/.test(o.source_ref)) o.done_at = new Date().toISOString(); });
  X.T.outbox.forEach((o) => { if (o.source_ref === 'chit:bill1') o.done_at = new Date().toISOString(); });
  ok('accepted → "bills to accept" is gone', kinds(await todo()).indexOf('bills_to_accept') < 0);
  const stk = await BP.closingStock(SHOP, S, { date: '2026-10-31', value: 500 }, SHOP);
  ok('closing stock entered → that row is gone', stk.ok && kinds(await todo()).indexOf('closing_stock_missing') < 0, JSON.stringify(stk));
  /* M1 (PAY-FIX): closing October locks it, and the sweep's reversal is dated 1 Oct — so the sweep runs BEFORE the close, as it does every day in life */
  const sw = await R.sweep(SHOP, S, DAY, { autoPost: true });
  ok('the sweep turns the accrual back → that row is gone', sw.reversed.length === 1 && kinds(await todo()).indexOf('accrual_reversals_due') < 0, JSON.stringify(sw));
  const gc = await BP.gstClose(SHOP, S, { fy: '2026-27', period: 7 }, SHOP);
  ok('closing the month with no credit to set off leaves the tax still to pay — the row stays', gc.ok && get(await todo(), 'gst_due'), JSON.stringify(gc));
  const gp = await BP.gstPay(SHOP, S, { fy: '2026-27', period: 7, amounts: { cgst_minor: 27000, sgst_minor: 27000 }, challan_no: 'CPIN-OCT', bank: 'bank', date: '2026-11-05' }, SHOP);
  ok('the challan paid → "GST due" is gone', gp.ok && kinds(await todo()).indexOf('gst_due') < 0, JSON.stringify(gp));
  const acc = await q('POST', '/recurring/' + rec.body.recurring_id + '/post', {});
  ok('rent accepted → "repeating entry due" is gone', acc.status === 200 && kinds(await todo()).indexOf('recurring_due') < 0, JSON.stringify(acc.body).slice(0, 200));
  for (let p = 1; p <= 7; p++) await q('POST', '/periods/2026-27/' + p + '/lock', { reason: 'done' });
  ok('the seven months locked → "months not locked" is gone', kinds(await todo()).indexOf('months_not_locked') < 0);

  /* the year just ended */
  DAY = '2027-04-10';
  await sale('2027-02-05', 'chit:feb');
  for (let p = 8; p <= 12; p++) await q('POST', '/periods/2026-27/' + p + '/lock', { reason: 'done' });
  let t3 = await todo();
  ok('after the year end, with every month locked and the books square: "year close possible" (2026-27), the call named', get(t3, 'year_close_possible') && get(t3, 'year_close_possible').items[0].fiscal_year === '2026-27' && /year\/2026-27\/close/.test(get(t3, 'year_close_possible').action.call), JSON.stringify(kinds(t3)));
  const cl = await q('POST', '/year/2026-27/close', {});
  t3 = await todo();
  ok('year closed → that row is gone', cl.status === 200 && kinds(t3).indexOf('year_close_possible') < 0 && kinds(t3).indexOf('months_not_locked') < 0, JSON.stringify([cl.body, kinds(t3)]));
  srv.close();
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
