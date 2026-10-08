/**
 * books-routes.test.cjs — /api/books THROUGH REAL EXPRESS, with a stand-in auth, db and store (no database).
 *
 * Proves: every route 404s while the ledger is off (the web's door stays shut) · the owner-only writes refuse a
 * co-assist (hard lock, write-off, entries, opening, packs) · the answers have the shapes the Ledger screen reads
 * (chitbridge-web public/app/cap-books.js, books-web d66bb0a1) · a payment in a locked month is refused in words and
 * leaves no half-recorded payment · a duplicate tax id is a 409 DUPLICATE_PARTY.
 * Needs the books engines v1.8.0 for the "on" half (BOOKS_ENGINES_SRC); without them it says so and checks the "off" half.
 * Run: node tests/books-routes.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const has = (o, keys) => keys.every((k) => o && Object.prototype.hasOwnProperty.call(o, k));

const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222', SUPP = '33333333-3333-4333-8333-333333333333';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Mayur Bhavan' };
const STAFF = { identity_id: '44444444-4444-4444-8444-444444444444', parent_entity_id: SHOP, identity_type: 'actor' };
let WHO = OWNER;
const authStub = Object.assign((req, res, next) => { req.identity = WHO; next(); }, {
  entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id,
  requireScope: () => (req, res, next) => next(),
});

const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});

(async () => {
  console.log('\n══ /api/books — the routes, their gates and their shapes ══\n');
  const X = H.load({ auth: authStub });
  require.cache[require.resolve(path.join(H.API, 'lib', 'storage-object'))] = { exports: { available: async () => false } };
  const TC = require(path.join(H.API, 'lib', 'tax-copy')); TC.ledgerFor = async () => { throw new Error('no chits in this test'); };
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/books' + p, b);

  /* ── OFF: every door is a 404 ── */
  const ROUTES = [['GET', '/health'], ['GET', '/accounts'], ['POST', '/accounts'], ['GET', '/daybook'], ['GET', '/ledger/1300'], ['GET', '/party/' + CUST + '/statement'],
    ['GET', '/dues'], ['GET', '/trial-balance'], ['GET', '/pl'], ['GET', '/bs'], ['POST', '/payments'], ['POST', '/payments/' + CUST + '/propose'], ['POST', '/payments/' + CUST + '/confirm'],
    ['POST', '/cheques/' + CUST + '/status'], ['GET', '/cheques'], ['POST', '/entries'], ['POST', '/entries/' + CUST + '/reverse'], ['POST', '/write-off'], ['POST', '/opening'],
    ['POST', '/periods/2026-27/6/lock'], ['POST', '/periods/2026-27/6/unlock'], ['GET', '/periods'], ['GET', '/packs'], ['POST', '/packs'], ['GET', '/packs/' + CUST],
    ['GET', '/packs/' + CUST + '/file'], ['POST', '/packs/' + CUST + '/ack'], ['POST', '/setting'], ['POST', '/check'], ['POST', '/outbox/retry'], ['POST', '/parties/' + CUST + '/dispute']];
  const offs = [];
  for (const [m, p] of ROUTES) { const r = await q(m, p, {}); if (r.status !== 404) offs.push(m + ' ' + p + ' → ' + r.status); }
  ok('books OFF: all ' + ROUTES.length + ' routes answer 404 (the web\'s Ledger door stays shut)', offs.length === 0, offs.join(' · '));
  const st = await q('GET', '/status');
  /* MOVED 2026-09-30 (critic M1): this asserted `migrated === false` for a shop with NO ROW — the very confusion that made the
     switch impossible to turn on. No row = off, tables there. "Not migrated" (42P01 only) is held in tests/books-fixes.test.cjs. */
  ok('GET /status answers while off (owner): the tables are there, this shop is not enabled', st.status === 200 && st.body.enabled === false && st.body.migrated === true, JSON.stringify(st.body));
  WHO = STAFF; ok('…and refuses a co-assist (403)', (await q('GET', '/status')).status === 403); ok('POST /enable refuses a co-assist', (await q('POST', '/enable')).status === 403); WHO = OWNER;

  if (!X.src.dir) { console.log('\n   SKIP the "on" half: ' + X.src.why); srv.close(); return done(); }

  /* ── ON ── */
  await X.store.saveSetting(X.db, SHOP, { enabled: false });
  const en = await q('POST', '/enable', {});
  ok('POST /enable seeds and switches on', en.status === 200 && en.body.ok && en.body.accounts_added > 60, JSON.stringify(en.body));
  X.T.parties.push({ owner: SHOP, party_id: CUST, party_no: 'P-00001', name: 'Ravi Stores', nickname: 'Ravi', customer: true, credit_days: 10 },
    { owner: SHOP, party_id: SUPP, party_no: 'P-00002', name: 'Kumar Traders', supplier: true, credit_days: 30 });
  const hl = await q('GET', '/health');
  ok('GET /health → { enabled: true, … }', hl.status === 200 && hl.body.enabled === true && Array.isArray(hl.body.waiting), JSON.stringify(hl.body));
  const ac = await q('GET', '/accounts');
  ok('GET /accounts → { accounts: [{ code, name, is_group, tally_group }] }', ac.status === 200 && ac.body.accounts.length > 60 && has(ac.body.accounts[0], ['code', 'name', 'is_group', 'tally_group']));
  const grp = ac.body.accounts.find((a) => a.is_group && a.name === 'Indirect Expenses');
  const na = await q('POST', '/accounts', { name: 'Security guard', parent_code: grp.code });
  ok('POST /accounts { name, parent_code } → { account: { code } } in the group\'s range', na.status === 200 && /^6\d{3}$/.test(na.body.account.code), JSON.stringify(na.body));
  WHO = STAFF; ok('…a co-assist cannot add a ledger (owner only)', (await q('POST', '/accounts', { name: 'X', parent_code: grp.code })).status === 403); WHO = OWNER;

  /* a sale on credit and a purchase, through the one writer */
  const B = X.B;
  await B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-09-05', currency: 'INR', party: CUST, source_chit_id: 'c0000000-0000-4000-8000-00000000000a', source_ref: 'chit:a',
    by_rate: [{ rate: 5, taxable: 1000, cgst: 25, sgst: 25, igst: 0 }], paid: {}, round_off: 0 });
  /* the bill as the counter sends it: its number, its counter, and who was signed in there (till.by — till.html chitOf) */
  X.T.chits.push({ chit_id: 'c0000000-0000-4000-8000-00000000000a', bill_no: 'C1-0042', entity_id: SHOP, purpose: 'order',
    business_json: { bill_no: 'C1-0042', till: { id: 'C2', name: 'Counter 2', by: { id: STAFF.identity_id, name: 'Athi', kind: 'coassist' } } } });
  await B.postEntry(X.db, SHOP, { type: 'purchase_bill', date: '2026-09-06', currency: 'INR', party: SUPP, source_chit_id: 'c0000000-0000-4000-8000-00000000000b', source_ref: 'chit:b',
    by_rate: [{ rate: 12, taxable: 500, cgst: 30, sgst: 30, igst: 0 }], paid: {}, round_off: 0 });

  const db = await q('GET', '/daybook?from=2026-09-01&to=2026-09-30');
  const e0 = db.body.entries && db.body.entries[0];
  ok('GET /daybook → { entries: [{ entry_no, posting_date, source_chit_id, narration, lines: [{ code, name, party_name, dr_minor, cr_minor }] }] }',
    db.status === 200 && db.body.entries.length === 2 && has(e0, ['entry_no', 'posting_date', 'source_chit_id', 'narration', 'lines']) && has(e0.lines[0], ['code', 'name', 'party_name', 'dr_minor', 'cr_minor'])
    && e0.lines.some((l) => l.party_name === 'Ravi'), JSON.stringify(db.body).slice(0, 300));
  const lg = await q('GET', '/ledger/1300?from=2026-09-01&to=2026-09-30');
  ok('GET /ledger/:acc → { currency, opening_minor, lines: [{ date, what, ref, source_chit_id, dr_minor, cr_minor, running_minor }], closing_minor }',
    lg.status === 200 && lg.body.currency === 'INR' && has(lg.body, ['opening_minor', 'lines', 'closing_minor']) && has(lg.body.lines[0], ['date', 'what', 'ref', 'source_chit_id', 'dr_minor', 'cr_minor', 'running_minor'])
    && lg.body.closing_minor === 105000, JSON.stringify(lg.body).slice(0, 300));
  const sm = await q('GET', '/party/' + CUST + '/statement');
  ok('GET /party/:id/statement → the same shape; closing = 1050.00 owed', sm.status === 200 && has(sm.body, ['currency', 'opening_minor', 'lines', 'closing_minor']) && sm.body.closing_minor === 105000
    && has(sm.body.lines[0], ['date', 'what', 'ref', 'source_chit_id', 'dr_minor', 'cr_minor', 'running_minor']), JSON.stringify(sm.body).slice(0, 300));
  const du = await q('GET', '/dues?asOf=2026-09-30');
  const dc = (du.body.parties || []).find((p) => p.party_id === CUST), ds = (du.body.parties || []).find((p) => p.party_id === SUPP);
  ok('GET /dues → { currency, parties: [{ party_id, party_no, name, balance_minor, oldest_due, disputed_minor, buckets }] }',
    du.status === 200 && du.body.currency === 'INR' && dc && has(dc, ['party_id', 'party_no', 'name', 'balance_minor', 'oldest_due', 'disputed_minor', 'buckets']), JSON.stringify(du.body).slice(0, 400));
  ok('…the customer owes (+1050.00, due 15 Sep, overdue < 6 months); the supplier is owed (−560.00)', dc && dc.balance_minor === 105000 && dc.oldest_due === '2026-09-15' && dc.buckets.lt_6m === 105000
    && ds && ds.balance_minor === -56000, JSON.stringify([dc, ds]));
  const tb = await q('GET', '/trial-balance?asOf=2026-09-30');
  ok('GET /trial-balance → { rows: [{ code, name, dr_minor, cr_minor }], total_dr_minor, total_cr_minor } and it balances',
    tb.status === 200 && has(tb.body.rows[0], ['code', 'name', 'dr_minor', 'cr_minor']) && tb.body.total_dr_minor === tb.body.total_cr_minor && tb.body.total_dr_minor > 0, JSON.stringify(tb.body).slice(0, 300));
  const pl = await q('GET', '/pl?from=2026-04-01&to=2026-09-30');
  ok('GET /pl → { income: [{ code, name, amount_minor }], expense: [...], profit_minor } = 1000 − 500',
    pl.status === 200 && has(pl.body.income[0], ['code', 'name', 'amount_minor']) && Array.isArray(pl.body.expense) && pl.body.profit_minor === 50000, JSON.stringify(pl.body).slice(0, 300));
  const bs = await q('GET', '/bs?asOf=2026-09-30');
  ok('GET /bs → { assets, liabilities, equity, total_assets_minor, total_liab_equity_minor } and it balances',
    bs.status === 200 && has(bs.body, ['assets', 'liabilities', 'equity', 'total_assets_minor', 'total_liab_equity_minor']) && bs.body.total_assets_minor === bs.body.total_liab_equity_minor
    && bs.body.equity.some((r) => /Profit/.test(r.name)), JSON.stringify(bs.body).slice(0, 400));

  /* ── /bs also carries the Schedule III grouping (additive) ── */
  const s3 = bs.body.schedule_iii, ORDER = ['ppe', 'investments', 'inventories', 'trade_receivables', 'cash_equivalents', 'short_term_loans_advances', 'other_current_assets', 'share_capital', 'reserves_surplus',
    'borrowings', 'trade_payables', 'other_current_liabilities', 'short_term_provisions', 'suspense', 'branch'];
  const inOrder = (heads) => heads.every((h, i) => !i || ORDER.indexOf(heads[i - 1].line) <= ORDER.indexOf(h.line));
  ok('GET /bs → schedule_iii: both sides have heads (each with line, label, total_minor, ledgers[{ code, name, amount_minor }]) in Schedule III order',
    s3 && s3.assets.heads.length >= 1 && s3.equity_and_liabilities.heads.length >= 2 /* R4 (engines v1.14.0): Input GST is an ASSET now, so the liabilities side lost its third head */ && inOrder(s3.assets.heads) && inOrder(s3.equity_and_liabilities.heads)
    && has(s3.assets.heads[0], ['line', 'label', 'total_minor', 'ledgers']) && has(s3.assets.heads[0].ledgers[0], ['code', 'name', 'amount_minor']), JSON.stringify(s3).slice(0, 500));
  const allL = [].concat(...s3.assets.heads.map((h) => h.ledgers), ...s3.equity_and_liabilities.heads.map((h) => h.ledgers));
  ok('…a shop with creditors and input GST: side totals are the real sums, equal and non-zero; balanced: true, difference 0',
    s3.assets.total_minor > 0 && s3.assets.total_minor === s3.equity_and_liabilities.total_minor && s3.balanced === true && s3.difference_minor === 0
    && s3.assets.total_minor === s3.assets.heads.reduce((t, h) => t + h.total_minor, 0) && s3.equity_and_liabilities.heads.some((h) => h.line === 'trade_payables' && h.total_minor === 56000)
    && /GST/i.test(JSON.stringify(allL)) && s3.assets.total_minor === bs.body.total_assets_minor, JSON.stringify(s3).slice(0, 600));
  /* R4 (engines v1.14.0, ledger.balanceSheet): a net GST debit is presented under Other current assets, never as a liability */
  const oca = s3.assets.heads.find((h) => h.line === 'other_current_assets');
  ok('…Input GST lands under ASSETS → Other current assets (2210 + 2211 = 1000), not on the liabilities side; the sides are equal and non-zero',
    !!oca && oca.total_minor === 1000 && ['2210', '2211'].every((c) => oca.ledgers.some((l) => l.code === c && l.amount_minor === 500))
    && !s3.equity_and_liabilities.heads.some((h) => h.ledgers.some((l) => /^22(10|11)$/.test(String(l.code))))
    && s3.assets.total_minor === 106000 && s3.assets.total_minor === s3.equity_and_liabilities.total_minor && s3.assets.total_minor > 0, JSON.stringify(s3).slice(0, 600));
  ok('…the profit so far is its own named line under Reserves and surplus ("Net profit", sign kept)',
    s3.equity_and_liabilities.heads.some((h) => h.line === 'reserves_surplus' && h.ledgers.some((l) => l.name === 'Net profit' && l.amount_minor === 50000)));
  ok('…the old flat keys are untouched (assets / liabilities / equity rows { code, name, amount_minor, line }, by_line, profit_to_date_minor)',
    has(bs.body.assets[0], ['code', 'name', 'amount_minor', 'line']) && Array.isArray(bs.body.by_line.assets) && Array.isArray(bs.body.by_line.liabilities) && bs.body.profit_to_date_minor === 50000
    && bs.body.balanced === true && bs.body.equity.some((r) => r.name === 'Profit for the year to date'));

  /* payments */
  const pay = await q('POST', '/payments', { party_id: CUST, direction: 'in', amount_minor: 60000, currency: 'INR', mode: 'upi', reference: 'UTR123', received_at: '2026-09-20T10:00:00Z' });
  ok('POST /payments → { payment: { payment_id, status: "recorded" } }', pay.status === 200 && pay.body.payment && pay.body.payment.status === 'recorded' && pay.body.payment.payment_id, JSON.stringify(pay.body));
  const pr = await q('POST', '/payments/' + pay.body.payment.payment_id + '/propose', {});
  const p0 = pr.body.proposal && pr.body.proposal[0];
  ok('POST /payments/:id/propose → { proposal: [{ against_ref, bill_no, due_date, open_minor, apply_minor, disputed }] }',
    pr.status === 200 && has(p0, ['against_ref', 'bill_no', 'due_date', 'open_minor', 'apply_minor', 'disputed']) && p0.bill_no === 'C1-0042' && p0.open_minor === 105000 && p0.apply_minor === 60000, JSON.stringify(pr.body));
  const cf = await q('POST', '/payments/' + pay.body.payment.payment_id + '/confirm', { allocations: [{ against_ref: p0.against_ref, amount_minor: 60000 }] });
  ok('POST /payments/:id/confirm { allocations } → allocated', cf.status === 200 && cf.body.ok && cf.body.allocated_minor === 60000, JSON.stringify(cf.body));
  const over = await q('POST', '/payments/' + pay.body.payment.payment_id + '/confirm', { allocations: [{ against_ref: p0.against_ref, amount_minor: 1 }] });
  ok('…confirming more than the payment has left is refused (422, in words)', over.status === 422 && typeof over.body.error === 'string', JSON.stringify(over.body));
  const chq = await q('POST', '/payments', { party_id: CUST, direction: 'in', amount_minor: 10000, currency: 'INR', mode: 'cheque', cheque: { number: '000777', bank: 'SBI', date: '2026-09-21' }, received_at: '2026-09-21' });
  ok('a cheque → { payment: { status: "cheque_received" } } (nothing to propose until it clears)', chq.status === 200 && chq.body.payment.status === 'cheque_received');
  const ck1 = await q('POST', '/cheques/' + chq.body.payment.payment_id + '/status', { status: 'deposited' });
  const ck2 = await q('POST', '/cheques/' + chq.body.payment.payment_id + '/status', { status: 'cleared', date: '2026-09-24' });
  ok('POST /cheques/:id/status deposited → cleared posts the entry', ck1.status === 200 && ck2.status === 200 && ck2.body.posted && ck2.body.posted.ok, JSON.stringify(ck2.body));

  /* locks */
  WHO = STAFF; ok('POST /periods/…/lock refuses a co-assist (owner only — the screen does not check)', (await q('POST', '/periods/2026-27/5/lock', { reason: 'x', hard: true })).status === 403); WHO = OWNER;
  const lk = await q('POST', '/periods/2026-27/5/lock', { reason: 'GSTR-1 filed' });
  ok('POST /periods/:fy/:p/lock → { period: { status: "soft_locked" } }', lk.status === 200 && lk.body.period.status === 'soft_locked', JSON.stringify(lk.body));
  const nP = X.T.payments.length;
  const lp = await q('POST', '/payments', { party_id: CUST, direction: 'in', amount_minor: 100, currency: 'INR', mode: 'cash', received_at: '2026-08-10' });
  ok('a payment dated in a locked month → 409 PERIOD_LOCKED with the exact sentence', lp.status === 409 && lp.body.code === 'PERIOD_LOCKED'
    && lp.body.error === 'That month is locked. Open it again (with a reason) to record this.', JSON.stringify(lp.body));
  const src = require('fs').readFileSync(path.join(H.API, 'routes', 'books.js'), 'utf8');
  const payH = src.slice(src.indexOf("router.post('/payments', "), src.indexOf("router.post('/payments/:id/propose'"));
  const bsrc = require('fs').readFileSync(path.join(H.API, 'lib', 'books.js'), 'utf8');
  const recP = bsrc.slice(bsrc.indexOf('async function recordPayment('), bsrc.indexOf('/** the payment\'s journal event'));
  /* M26: the route's one withEntity now also asks the duplicate rule first and reads the outcome after — still ONE handle, still
     one insertPayment and two postEntry in recordPayment (the bills are settled by settleBills on that same handle) */
  const payTx = payH.slice(payH.indexOf('await withEntity(e, async (h) => {'), payH.indexOf('return rec;'));
  ok('…and the payment row and its entry are ONE transaction (the route hands recordPayment one handle; it inserts and posts on it)',
    /B\.recordPayment\(h, e,/.test(payTx) && !/withEntity/.test(payTx.slice(10)) && /S\.insertPayment\(h, entity, p\)/.test(recP) && (recP.match(/postEntry\(h, entity,/g) || []).length === 2 && nP >= 0);
  const ul0 = await q('POST', '/periods/2026-27/5/unlock', {});
  ok('unlock without a reason is refused', ul0.status === 422);
  const ul = await q('POST', '/periods/2026-27/5/unlock', { reason: 'late supplier bill' });
  ok('POST /periods/:fy/:p/unlock { reason } → { period: { status: "open" } }', ul.status === 200 && ul.body.period.status === 'open');

  /* owner-only writes */
  WHO = STAFF;
  const so = [['POST', '/write-off', { party_id: CUST, amount_minor: 100, reason: 'x' }], ['POST', '/entries', {}], ['POST', '/opening', { rows: [] }], ['POST', '/packs', { kind: 'month' }]];
  const leaks = []; for (const [m, p, b] of so) { const r = await q(m, p, b); if (r.status !== 403) leaks.push(p + ' → ' + r.status); }
  ok('write-off, manual entries, opening and packs refuse a co-assist', leaks.length === 0, leaks.join(' · '));
  WHO = OWNER;

  /* opening */
  const both = await q('POST', '/opening', { rows: [{ code: '1400', dr_minor: 100, cr_minor: 100 }] });
  ok('POST /opening: a row with both debit and credit is refused (400)', both.status === 400);
  const op = await q('POST', '/opening', { rows: [{ code: '1400', dr_minor: 500000 }, { code: '1300', party_no: 'P-00001', dr_minor: 200000, bill_ref: 'OLD-7', due_date: '2026-05-01' }, { code: '3000', cr_minor: 600000 }] });
  ok('POST /opening { rows } → { entry_no, suspense_minor } (100000 short → Suspense)', op.status === 200 && /^JV\//.test(op.body.entry_no) && op.body.suspense_minor === 100000, JSON.stringify(op.body));
  const nop = await q('POST', '/opening', { rows: [{ code: '1300', party_no: 'P-09999', dr_minor: 1 }] });
  ok('…an unknown party number is refused in words', nop.status === 422 && /P-09999/.test(nop.body.error), JSON.stringify(nop.body));

  /* packs */
  const pk = await q('POST', '/packs', { kind: 'month', fiscal_year: '2026-27', period: 6 });
  ok('POST /packs builds a month pack (CBBookPack) and says it is not stored without storage', pk.status === 200 && pk.body.pack && pk.body.pack.stored === false && pk.body.pack.sha256, JSON.stringify(pk.body).slice(0, 300));
  const pl2 = await q('GET', '/packs');
  const k0 = pl2.body.packs && pl2.body.packs[0];
  ok('GET /packs → { packs: [{ pack_id, kind, fiscal_year, period, created_at, sha256, acknowledged_at }] }', pl2.status === 200 && has(k0, ['pack_id', 'kind', 'fiscal_year', 'period', 'created_at', 'sha256', 'acknowledged_at']));
  const pg = await q('GET', '/packs/' + k0.pack_id);
  const f0 = pg.body.manifest && pg.body.manifest.files && pg.body.manifest.files[0];
  ok('GET /packs/:id → { pack, manifest: { files: [{ name, sha256, bytes }], controls } }', pg.status === 200 && has(pg.body, ['pack', 'manifest']) && has(f0, ['name', 'sha256', 'bytes']) && pg.body.manifest.controls
    && pg.body.manifest.controls.totals && pg.body.manifest.controls.totals.balanced === true, JSON.stringify(pg.body).slice(0, 400));
  const names = pg.body.manifest.files.map((f) => f.name);
  ok('…every file hashed; saft.json, the change log and the Tally masters + vouchers among them', pg.body.manifest.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256))
    && ['saft.json', 'change_log.csv', 'tally-masters.xml', 'tally-vouchers.xml'].every((n) => names.indexOf(n) >= 0), names.join(', '));
  ok('…the Tally files are the ADAPTER\'s (tally_xml_status "adapter"), the engine\'s tally.xml is gone, and what is unproven is said', pg.body.manifest.tally_xml_status === 'adapter'
    && names.indexOf('tally.xml') < 0 && /Only the Receipt voucher/.test(pg.body.manifest.tally.proven) && Array.isArray(pg.body.manifest.tally.needs_review), JSON.stringify(pg.body.manifest.tally));
  const BPx = X.E.bookpack(), mm = X.T.packs[0].manifest;
  ok('…the manifest is sealed once: its own hash is the pack\'s, and covers the file list', mm.sha256 === pk.body.pack.sha256
    && BPx.seal(Object.assign({}, mm, { sha256: null }), Object.fromEntries(mm.files.map((f) => [f.file, f.sha256])), require(path.join(H.API, 'lib', 'books-pack')).sha).sha256 === mm.sha256);
  const pk2 = await q('POST', '/packs', { kind: 'month', fiscal_year: '2026-27', period: 6 });
  ok('…the next pack is chained to this one (prev_sha256)', pk2.body.manifest && pk2.body.manifest.prev_sha256 === pk.body.pack.sha256, JSON.stringify(pk2.body.manifest && pk2.body.manifest.prev_sha256));
  /* MOVED 2026-09-30 (critic M10): this pack was built with no storage, and acknowledging it answered 200 — the shop "had" a
     pack it could never have downloaded. An unstored pack is now refused; the handover of a STORED pack (download, then
     acknowledge) is held in tests/books-fixes.test.cjs. */
  const ak = await q('POST', '/packs/' + k0.pack_id + '/ack', {});
  ok('POST /packs/:id/ack of a pack with no stored file is refused (409 PACK_NO_FILE) — nothing to acknowledge', ak.status === 409 && ak.body.code === 'PACK_NO_FILE' && !ak.body.acknowledged_at, JSON.stringify(ak.body));
  const fl = await q('GET', '/packs/' + k0.pack_id + '/file');
  ok('GET /packs/:id/file of an unstored pack → 409 in words (never an empty file)', fl.status === 409 && /storage/.test(fl.body.error));

  /* the party fields: a duplicate tax id is a 409 DUPLICATE_PARTY */
  const PF = require(path.join(H.API, 'lib', 'party-fields'));
  const fdb = { query: async (text, params) => {
    const t = text.replace(/\s+/g, ' ');
    if (/^SAVEPOINT|^RELEASE|^ROLLBACK/.test(t)) return { rows: [] };
    if (/FROM customer_list WHERE customer_list_id/.test(t)) return { rows: [{ customer_list_id: params[0], customer_identity_id: CUST, legal_name: null, nickname: null, credit_days: null }] };
    if (/SELECT scheme, value FROM party_tax_id/.test(t)) return { rows: [] };
    if (/JOIN identities i ON i.identity_id = t.party_id/.test(t)) return { rows: [{ party_id: SUPP, display_name: 'Kumar Traders' }] };
    return { rows: [] };
  } };
  let dup = null; try { await PF.patch(fdb, SHOP, 'customer', 'row1', { tax_ids: [{ scheme: 'GSTIN', value: '33abcde1234f1z5' }] }, SHOP); } catch (e) { dup = e; }
  ok('the same GSTIN on another party → 409 DUPLICATE_PARTY with the exact sentence, and who holds it', dup && dup.code === 'DUPLICATE_PARTY' && dup.status === 409
    && dup.message === 'Another party already has this tax id.' && dup.holder === 'Kumar Traders', dup && JSON.stringify({ m: dup.message, h: dup.holder }));
  let badS = null; try { PF.cleanTaxIds([{ scheme: 'SSN', value: '1' }]); } catch (e) { badS = e; }
  ok('an unknown tax id kind is refused', badS && badS.status === 400);
  const cl = PF.clean('customer', { credit_limit: '2500.50', credit_days: '15', state_code: '33', nickname: '  Ravi  ' });
  ok('party fields clean: limit in minor units, days a whole number, nickname trimmed', cl.credit_limit_minor === 250050 && cl.credit_days === 15 && cl.nickname === 'Ravi' && cl.state_code === '33', JSON.stringify(cl));

  /* ── WHERE AN ENTRY CAME FROM (Athi, 2026-10-01, the first real entry: "where is it referenced to the sale record, how do I
     connect to the sale record, who has done it?") — every entry names its bill, its counter, who sold it; a day its count ── */
  const DAY = ['d0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000003'];
  const day = X.E.posting().daySummary([{ currency: 'INR', pay: { cash: 118 }, taxes: [{ rate: 18, taxable: 100, cgst: 9, sgst: 9, igst: 0 }], round_off: 0 },
    { currency: 'INR', pay: { cash: 118 }, taxes: [{ rate: 18, taxable: 100, cgst: 9, sgst: 9, igst: 0 }], round_off: 0 },
    { currency: 'INR', pay: { upi: 118 }, taxes: [{ rate: 18, taxable: 100, cgst: 9, sgst: 9, igst: 0 }], round_off: 0 }], { ref: 'walkin C2 2026-09-28', date: '2026-09-28', counter: 'C2' });
  await B.postEntry(X.db, SHOP, Object.assign(day, { source_ref: 'walkin:C2:2026-09-28', source_chit_ids: DAY, counter: 'C2', by: SHOP, narration: 'Walk-in sales, counter C2, 2026-09-28 (3 bills)' }));
  const sb = await q('GET', '/daybook?from=2026-09-01&to=2026-09-30');
  const ents = sb.body.entries || [];
  const bill = ents.find((x) => x.event_type === 'sale_bill'), wday = ents.find((x) => x.event_type === 'walkin_day'), upi = ents.find((x) => x.event_type === 'payment_received');
  ok('GET /daybook: a bill entry names its source — { chit_id, ref: the printed number, kind: "bill", counter, by: who was signed in }',
    bill && bill.source && bill.source.chit_id === 'c0000000-0000-4000-8000-00000000000a' && bill.source.ref === 'C1-0042' && bill.source.kind === 'bill'
    && bill.source.counter === 'C2' && bill.source.by === 'Athi', JSON.stringify(bill && bill.source));
  ok('…a walk-in day names how many bills it covers, and its counter (kind "day", no single bill, no single seller)',
    wday && wday.source && wday.source.kind === 'day' && wday.source.count === 3 && wday.source.counter === 'C2' && wday.source.chit_id === null && wday.source.ref === null && wday.source.by === null,
    JSON.stringify(wday && wday.source));
  ok('…an entry with no chit behind it (a payment typed in the Ledger) has source null', upi && upi.source === null, JSON.stringify(upi && upi.source));
  const sl = await q('GET', '/ledger/1300?from=2026-09-01&to=2026-09-30');
  const sl0 = (sl.body.lines || []).find((l) => l.source_chit_id === 'c0000000-0000-4000-8000-00000000000a'), sl1 = (sl.body.lines || []).find((l) => !l.source_chit_id);
  ok('GET /ledger/:acc: each line carries the same source (bill C1-0042 · C2 · Athi); a line with no chit has source null',
    sl0 && sl0.source && sl0.source.ref === 'C1-0042' && sl0.source.counter === 'C2' && sl0.source.by === 'Athi' && sl1 && sl1.source === null, JSON.stringify([sl0, sl1]));
  /* a bill nobody signed in for: the entry's own writer names it (created_by → identities), else null — never a guess */
  X.T.identities.push({ identity_id: SHOP, display_name: 'Mayur Bhavan' });
  X.T.chits.push({ chit_id: 'c0000000-0000-4000-8000-00000000000c', entity_id: SHOP, purpose: 'order', business_json: { bill_no: 'C1/26-27/0009', printed_as: 'C1/26-27/0009', till: { id: 'C1', by: null } } });
  await B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-09-27', currency: 'INR', party: CUST, source_chit_id: 'c0000000-0000-4000-8000-00000000000c', source_ref: 'chit:c', by: SHOP,
    by_rate: [{ rate: 5, taxable: 100, cgst: 2.5, sgst: 2.5, igst: 0 }], paid: { cash: 105 }, round_off: 0 });
  const nb = ((await q('GET', '/daybook?from=2026-09-27&to=2026-09-27')).body.entries || [])[0];
  ok('…nobody signed in at the counter: "by" falls back to who wrote the entry (created_by → identities)', nb && nb.source && nb.source.by === 'Mayur Bhavan' && nb.source.counter === 'C1', JSON.stringify(nb && nb.source));
  /* a chit that is not this shop's own is never read (entity-scoped join): the entry keeps its id, the source names nothing of it */
  X.T.chits.push({ chit_id: 'c0000000-0000-4000-8000-00000000000d', entity_id: SUPP, purpose: 'invoice', business_json: { bill_no: 'THEIRS-1', till: { id: 'X9', by: { name: 'Someone else' } } } });
  await B.postEntry(X.db, SHOP, { type: 'purchase_bill', date: '2026-09-26', currency: 'INR', party: SUPP, source_chit_id: 'c0000000-0000-4000-8000-00000000000d', source_ref: 'chit:d',
    by_rate: [{ rate: 12, taxable: 100, cgst: 6, sgst: 6, igst: 0 }], paid: {}, round_off: 0 });
  const ot = ((await q('GET', '/daybook?from=2026-09-26&to=2026-09-26')).body.entries || [])[0];
  ok('…another entity\'s copy of a chit is never read: no ref, no counter, no seller from it', ot && ot.source && ot.source.kind === 'purchase' && ot.source.ref === null && ot.source.counter === null
    && ot.source.by === null && ot.source.chit_id === null, JSON.stringify(ot && ot.source));
  /* ── HOW IT WAS PAID (Athi, 2026-10-01, after 4–5 live bills: "it has to clearly segregate credit, cash, UPI") ── */
  X.T.chits.find((x) => x.chit_id === 'c0000000-0000-4000-8000-00000000000a').business_json.payment = { parts: [{ how: 'On credit', amount: 1050 }] };
  X.T.chits.find((x) => x.chit_id === 'c0000000-0000-4000-8000-00000000000c').business_json.payment = { parts: [{ how: 'Cash', amount: 50 }, { how: 'UPI', amount: 55, ref: '4421009931' }] };
  const RC = 'c0000000-0000-4000-8000-00000000000e';
  X.T.chits.push({ chit_id: RC, entity_id: SHOP, purpose: 'general', business_json: { kind: 'payment_received', payment_received: { no: 'R/C2/0001', mode: 'upi', amount: 100 },
    till: { id: 'C2', by: { name: 'Athi' } } } });
  await B.recordPayment(X.db, SHOP, { party_id: CUST, direction: 'in', amount_minor: 10000, currency: 'INR', mode: 'upi', reference: 'R/C2/0001', received_at: '2026-09-25',
    client_ref: 'chit:' + RC, source_chit_id: RC, by: SHOP });
  const hw = (await q('GET', '/daybook?from=2026-09-01&to=2026-09-30')).body.entries || [];
  const hb = hw.find((x) => x.source && x.source.ref === 'C1-0042'), hm = hw.find((x) => x.source && x.source.ref === 'C1/26-27/0009');
  const hd = hw.find((x) => x.source && x.source.kind === 'day'), hr = hw.find((x) => x.source && x.source.kind === 'receipt');
  ok('how: a credit bill says "On credit"', hb && hb.source.how === 'On credit' && hb.source.how_ref === null, JSON.stringify(hb && hb.source));
  ok('how: a split bill says "Cash + UPI", in order, with the UPI reference the counter kept', hm && hm.source.how === 'Cash + UPI' && hm.source.how_ref === '4421009931', JSON.stringify(hm && hm.source));
  ok('how: a walk-in day is its own split, read from the entry\'s lines (Cash 236.00 · UPI 118.00)', hd && hd.source.how === 'Cash · UPI'
    && JSON.stringify(hd.source.split) === JSON.stringify([{ how: 'Cash', amount_minor: 23600 }, { how: 'UPI', amount_minor: 11800 }]), JSON.stringify(hd && hd.source));
  ok('how: money received at the counter is a receipt — its number, UPI, counter, who', hr && hr.source.ref === 'R/C2/0001' && hr.source.how === 'UPI' && hr.source.counter === 'C2'
    && hr.source.by === 'Athi', JSON.stringify(hr && hr.source));
  ok('how: a bill without a split names none (split null)', hb && hb.source.split === null && hd && hd.source.how_ref === null);
  /* ── BOTH TIMES (Athi, 2026-10-01: "the time the bill was made or the time the entry was accepted? both should be there") ── */
  X.T.chits.find((x) => x.chit_id === 'c0000000-0000-4000-8000-00000000000a').business_json.billed_at = '2026-09-05T08:42:00.000Z';
  Object.assign(X.T.chits.find((x) => x.chit_id === 'c0000000-0000-4000-8000-00000000000c'), { created_at: '2026-09-27T05:00:00.000Z' });
  X.T.chits.find((x) => x.chit_id === 'c0000000-0000-4000-8000-00000000000c').business_json.billed_at = 'teatime';
  const tw = (await q('GET', '/daybook?from=2026-09-01&to=2026-09-30')).body.entries || [];
  const tb1 = tw.find((x) => x.source && x.source.ref === 'C1-0042'), tb2 = tw.find((x) => x.source && x.source.ref === 'C1/26-27/0009'), td = tw.find((x) => x.source && x.source.kind === 'day');
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  ok('times: a bill carries its own moment (billed_at) and the moment the ledger recorded it', tb1 && tb1.source.doc_at === '2026-09-05T08:42:00.000Z' && ISO.test(tb1.source.recorded_at || ''), JSON.stringify(tb1 && tb1.source));
  ok('times: a billed_at that is not a moment is skipped — the chit\'s created_at stands', tb2 && tb2.source.doc_at === '2026-09-27T05:00:00.000Z', JSON.stringify(tb2 && tb2.source));
  ok('times: a walk-in day has no one bill time, but says when it was recorded', td && td.source.doc_at === null && ISO.test(td.source.recorded_at || ''), JSON.stringify(td && td.source));
  ok('times: the day book still runs by posting date, then entry number', tw.every((x, i) => !i || tw[i - 1].posting_date < x.posting_date || (tw[i - 1].posting_date === x.posting_date && tw[i - 1].entry_no < x.entry_no)),
    tw.map((x) => x.posting_date + ' ' + x.entry_no).join(' · '));
  const ssrc = require('fs').readFileSync(path.join(H.API, 'lib', 'books-store.js'), 'utf8');
  const el = ssrc.slice(ssrc.indexOf('async function entryLines('), ssrc.indexOf('async function entries('));
  ok('…in ONE query: entryLines LEFT JOINs the shop\'s own chit_header (entity-scoped, ONE copy — a self-chit can have two, b149) and identities — never a read per row',
    /LEFT JOIN LATERAL \(SELECT [^)]*FROM chit_header x\s+WHERE x\.entity_id = \$1 AND x\.chit_id = h\.source_chit_id[^)]*LIMIT 1\) c ON true/.test(el) && /LEFT JOIN identities i ON i\.identity_id = h\.created_by/.test(el)
    && !/S\.(billNos|entry)\(/.test(src.slice(src.indexOf("router.get('/daybook'"), src.indexOf("router.get('/party/:id/statement'"))));

  /* a loss: salaries paid from cash, bigger than the profit so far → "Net loss" under capital, still balanced */
  const ls = await q('POST', '/entries', { narration: 'Salaries', date: '2026-09-08', lines: [{ code: '6020', dr_minor: 200000 }, { code: '1400', cr_minor: 200000 }] });
  const bl = await q('GET', '/bs?asOf=2026-09-30'), s3l = bl.body.schedule_iii, nloss = s3l && s3l.equity_and_liabilities.heads.find((h) => h.line === 'reserves_surplus');
  ok('/bs with a loss: the line reads "Net loss" (negative, sign kept) under Reserves and surplus, and the sides still balance',
    ls.status === 200 && nloss && nloss.ledgers.some((l) => l.name === 'Net loss' && l.amount_minor < 0 && l.amount_minor === bl.body.profit_to_date_minor) && !nloss.ledgers.some((l) => l.name === 'Net profit')
    && s3l.balanced === true && s3l.assets.total_minor === s3l.equity_and_liabilities.total_minor, JSON.stringify(s3l).slice(0, 600));

  srv.close();
  done();
})().catch((e) => { console.log('   FAIL threw: ' + (e && e.stack)); process.exit(1); });

function done() {
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
}
