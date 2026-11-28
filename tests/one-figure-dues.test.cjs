/**
 * one-figure-dues.test.cjs - ONE-FIGURE RC10 (28 Nov 2026, drift exit): "what customers owe / the shop owes" and "what one customer owes" each have ONE reader (lib/books-dues.js).
 *  1. controlTotals (the Home Finance card's To collect / To pay) = the dues page's total rows on real posted books (sales, purchases, a part-paid sale) - golden values hand-computed below.
 *  2. a control account that moved beside the party items: Home says the ledger (the books' truth), the dues page says its list; the difference is what books-dues.controlOf SHOWS (tb_control), pinned here.
 *  3. the counter's per-customer balance (receivableBills + foldByParty) = the dues engine's per-party outstanding on the same rows; open bills are listed only while owed; the payable side never enters.
 *  4. mutations go red: a fold that drops the sign, a controlTotals that swaps the roles, and (the guard) a second reader of the control account planted in lib/.
 * Offline, the in-memory books and the real engines. Run: node tests/one-figure-dues.test.cjs
 */
'use strict';
const path = require('path'), http = require('http'), cp = require('child_process');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111', RAVI = '77777777-7777-4777-8777-777777777777', ANAND = '88888888-8888-4888-8888-888888888888';
const ZERO = '00000000-0000-0000-0000-000000000000';
const owner = { identity_id: SHOP, identity_type: 'entity', display_name: 'Shop' };
const auth = Object.assign((req, res, next) => { req.identity = owner; next(); }, { entityOf: (req) => req.identity.identity_id, requireScope: () => (req, res, next) => next() });
const call = (port, p) => new Promise((done) => { http.request({ host: '127.0.0.1', port, path: p, method: 'GET', headers: { 'Identity-Type': 'entity' } }, (res) => { let raw = ''; res.on('data', (c) => (raw += c)); res.on('end', () => done((() => { try { return JSON.parse(raw); } catch (_) { return null; } })())); }).end(); });

(async () => {
  if (!H.enginesSrc().dir) { console.log('SKIP: ' + H.enginesSrc().why); process.exit(1); }
  const X = H.load({ auth });
  X.T.parties.push({ owner: SHOP, party_id: RAVI, party_no: 'P-00001', name: 'Ravi', customer: true, credit_days: 30, credit_limit_minor: null, terms: {} });
  X.T.parties.push({ owner: SHOP, party_id: ANAND, party_no: 'P-00002', name: 'Anand Mills', supplier: true, credit_days: 30, credit_limit_minor: null, terms: {} });
  const express = require('express'), app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0), port = srv.address().port;
  require(path.join(H.API, 'lib', 'bill-checks')).attach = async (h, e, req, prop) => { prop.proposal.forEach((r) => Object.assign(r, { entry_id: null, chit_id: null })); };
  require(path.join(H.API, 'lib', 'shop-clock')).set('2026-11-16T06:00:00Z');
  const cost = require(path.join(H.API, 'lib', 'cost')); const realBlind = cost.isCostBlind; cost.isCostBlind = async () => false;
  const Dues = require(path.join(H.API, 'lib', 'books-dues')), Engines = require(path.join(H.API, 'lib', 'books-engines'));
  try {
    await call(port, '/x');
    await new Promise((done) => { const r = http.request({ host: '127.0.0.1', port, path: '/api/books/enable', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': 2 } }, (res) => { res.resume(); res.on('end', done); }); r.end('{}'); });
    const sale = (day, no, amount, paid) => X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: day, currency: 'INR', party: RAVI, source_chit_id: 'c0000000-0000-4000-8000-0000000000' + no, by_rate: [{ rate: 0, taxable: amount }], paid: paid || {}, round_off: 0 });
    const buy = (day, no, amount) => X.B.postEntry(X.db, SHOP, { type: 'purchase_bill', ref: 'P' + no, date: day, currency: 'INR', party: ANAND, by_rate: [{ rate: 0, taxable: amount }], paid: {}, round_off: 0, source_ref: 'purchase:' + no });
    // hand-computed: Ravi owes 1000.00 + 2000.00 + (4000.00 less 1500.00 paid at once) = 5500.00 ; the shop owes Anand 1500.00 + 500.00 = 2000.00
    await sale('2026-07-10', '01', 1000); await sale('2026-08-10', '02', 2000); await sale('2026-11-10', '03', 4000, { cash: 1500 });
    await buy('2026-08-01', '01', 1500); await buy('2026-10-20', '02', 500);
    const helpers = { withEntity: async (e, fn) => fn(X.db) };
    const home = await require(path.join(H.API, 'lib', 'home-facts-finance')).financeRead(SHOP, helpers);
    const customerPage = await call(port, '/api/books/dues?side=customer'), supplierPage = await call(port, '/api/books/dues?side=supplier');
    ok('golden: Home To collect is 550000 and To pay is 200000 (hand-computed)', home.toCollect === 550000 && home.toPay === 200000, JSON.stringify([home.toCollect, home.toPay]));
    ok('Home To collect = the dues page customer total row (one figure, two doors)', home.toCollect === customerPage.aged_totals.customer.balance_minor, JSON.stringify(customerPage.aged_totals));
    ok('Home To pay = the dues page supplier total row, unsigned', home.toPay === -supplierPage.aged_totals.supplier.balance_minor, JSON.stringify(supplierPage.aged_totals));
    ok('controlTotals is the reader the card used (the same numbers straight from the lib)', JSON.stringify(await Dues.controlTotals(X.db, SHOP)) === JSON.stringify({ to_collect_minor: 550000, to_pay_minor: 200000 }));
    // 2: the control account moves by 10.00 beside the party items: Home follows the ledger, the page its list
    const chart = await X.store.accounts(X.db, SHOP), debtors = chart.find((account) => account.role === 'debtors');
    X.T.balances.set('tamper', { entity_id: SHOP, account_id: debtors.account_id, party_key: ZERO, currency: 'INR', fiscal_year: 2026, period: 11, dr_minor: 1000, cr_minor: 0, line_count: 1 });
    const moved = await Dues.controlTotals(X.db, SHOP);
    ok('a control account 10.00 above its party items: Home follows the ledger (the books\' truth) ...', moved.to_collect_minor === 551000, JSON.stringify(moved));
    ok('... and the dues page still totals its party list; the 10.00 is the difference controlOf shows', (await call(port, '/api/books/dues?side=customer')).aged_totals.customer.balance_minor === 550000);
    X.T.balances.delete('tamper');
    // 3: the counter's balance = the engine's per-party outstanding
    const row = (party, side, kind, ref, against, amount) => ({ item_id: ref + amount, party_id: party, side, ref_kind: kind, ref, against_ref: against, amount_minor: amount, currency: 'INR', doc_date: '2026-10-01', due_date: kind === 'bill' ? '2026-10-31' : null, created_at: '2026-10-01T06:00:00Z' });
    const stored = [row(RAVI, 'receivable', 'bill', 'B1', 'B1', 100000), row(RAVI, 'receivable', 'advance', 'R2', 'R2', -20000), row(RAVI, 'receivable', 'bill', 'B2', 'B2', 5000), row(ANAND, 'payable', 'bill', 'P1', 'P1', -70000)];
    const sql = [];
    const fake = { query: async (text) => { sql.push(text); const by = new Map(); stored.filter((r) => r.side === 'receivable').forEach((r) => { const k = r.party_id + '|' + r.against_ref, g = by.get(k) || { party_id: r.party_id, against_ref: r.against_ref, balance_minor: 0, due_date: null, doc_date: null, disputed: false }; g.balance_minor += r.amount_minor; if (r.ref_kind === 'bill') { g.due_date = r.due_date; g.doc_date = r.doc_date; } by.set(k, g); }); return { rows: Array.from(by.values()).filter((g) => g.balance_minor !== 0) }; } };
    const got = await Dues.receivableBills(fake, SHOP, 21);
    ok('receivableBills asks the receivable side only, with the cap passed through', /side = 'receivable'/.test(sql[0]) && /LIMIT \$2/.test(sql[0]));
    const folded = Dues.foldByParty(got.rows);
    const engine = Engines.dues(stored.filter((r) => r.side === 'receivable').map(Engines.itemOf), '2026-11-16', 'receivable', { pack: Engines.packs().packFor('IN') });
    ok('golden: Ravi balance 85000 = 100000 + 5000 - 20000 on account (hand-computed)', folded[RAVI].balance_minor === 85000, String(folded[RAVI] && folded[RAVI].balance_minor));
    ok('the counter balance = the dues engine per-party outstanding on the same rows', folded[RAVI].balance_minor === Number(engine.outstanding.by_party[RAVI]), JSON.stringify(engine.outstanding.by_party));
    ok('open bills list the bills still owed: B1 100000 (gross of the receipt on account) and B2 5000; a supplier row never enters', folded[RAVI].open_bills.map((b) => b.ref + ':' + b.balance_minor).join() === 'B1:100000,B2:5000' && !folded[ANAND], JSON.stringify(folded));
    ok('dates travel as the shop day (the one date reader)', folded[RAVI].open_bills[0].due_date === '2026-10-31' && folded[RAVI].open_bills[0].date === '2026-10-01');
    // 4: mutations
    const mutated = Dues.foldByParty(got.rows.map((r) => Object.assign({}, r, { balance_minor: Math.abs(Number(r.balance_minor)) })));
    ok('MUTATION: a fold that drops the sign is red against the engine', mutated[RAVI].balance_minor !== Number(engine.outstanding.by_party[RAVI]));
    ok('MUTATION: a reader that swaps the two roles is red against the golden', JSON.stringify({ to_collect_minor: 200000, to_pay_minor: 550000 }) !== JSON.stringify(await Dues.controlTotals(X.db, SHOP)));
    const run = (env) => cp.spawnSync(process.execPath, [path.join(__dirname, 'one-figure.test.cjs')], { env: Object.assign({}, process.env, env), encoding: 'utf8', windowsHide: true });
    const clean = run({});
    ok('the guard passes on the code as it is', clean.status === 0, clean.stdout.slice(-500));
    ok('MUTATION: a planted second reader of a guarded figure turns the guard red', run({ SCAN_SELFTEST: '1' }).status === 1);
  } finally { cost.isCostBlind = realBlind; srv.close(); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(fail ? 1 : 0);
})().catch((err) => { console.log('ERROR ' + (err && err.stack)); process.exit(1); });
