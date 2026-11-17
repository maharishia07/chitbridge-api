/**
 * tests/acc-269-expense-itc.test.cjs — ACC-269: GSTR-3B 4A READS AN EXPENSE CHIT'S INPUT TAX (the tax ACC-230 posts to input_cgst / input_sgst / input_igst).
 *
 * OWNS      the proof that lib/tax-copy.js ledgerFor adds an expense chit's POSTED input tax (read from the books through books-store.inputTaxOfChit) to the month's ITC,
 *           through the one sum (tax-lines.ledger -> gstr3b itc_elg), that an invoice-sourced ITC is not doubled (a chit that carries an invoice is never read from the ledger),
 *           that an expense with no posted tax changes nothing, and that AU BAS 1B (a posted-ledger read, gst-returns.returnFor) is unchanged.
 * CALLED BY the test library (api T1). Run: node tests/acc-269-expense-itc.test.cjs
 * CARD      14-accounting/gst-returns
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
const SHOP = '11111111-1111-4111-8111-111111111111';
const SUPPLIER = '22222222-2222-4222-8222-222222222222';
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const IDENTITY = { identity_id: SHOP, gstn: '33AAAAA0000A1Z5', display_name: 'Mayur Traders', country: 'IN', timezone: 'Asia/Kolkata', policy_flags: { price_includes_tax: 'no' } };
const SUPPLIER_ROW = { identity_id: SUPPLIER, gstn: '33BBBBB1111B1Z5', display_name: 'Supplier', country: 'IN', policy_flags: {} };
const AT = new Date().toISOString();
const month = AT.slice(0, 7);
const id = (n) => 'a0000000-0000-4000-8000-' + String(n).padStart(12, '0');
const party = { role: 'sender', entity_id: SHOP, display_name: 'Mayur Traders' };
const invoice = (taxable, tax) => ({ currency: 'INR', DocDtls: { Typ: 'INV' }, ItemList: [{ GstRt: 18, AssAmt: taxable, CgstAmt: tax / 2, SgstAmt: tax / 2, IgstAmt: 0, CesAmt: 0 }], ValDtls: { AssVal: taxable, CgstVal: tax / 2, SgstVal: tax / 2, IgstVal: 0, CesVal: 0, TotInvVal: taxable + tax } });
/** an expense chit as ACC-230 stores it: business_json.expense, no invoice, a self chit */
const expense = (n, x, extra) => ({ chit_id: id(n), sender_entity_id: SHOP, purpose: 'note', all_recipients: [party], business_json: Object.assign({ expense: Object.assign({ what: 'Repairs', mode: 'Cash', amount: 118 }, x) }, extra || {}), summary_json: { money: { total: 118 } }, sent_at: AT, created_at: AT, line_items: [], currency_code: 'INR' });
/** a purchase the shop received on the rail with the supplier's invoice (the invoice-sourced ITC: 18 tax on 100) */
const bought = (n) => ({ chit_id: id(n), sender_entity_id: SUPPLIER, purpose: 'invoice', all_recipients: [{ role: 'sender', entity_id: SUPPLIER }, { role: 'receiver', entity_id: SHOP }], business_json: { invoice: invoice(100, 18) }, summary_json: { money: { total: 118 } }, sent_at: AT, created_at: AT, line_items: [{ line_id: 'l', particulars: 'x', quantity: 1, price: 100, total: 118, gst_rate: 18 }], currency_code: 'INR' });

/** the real tax-copy on a fresh load, its db stubbed: copies come back for the copy read, `posted` ({ chit_id: { role: minor } }) for the books' input-tax read */
const roleReads = []; /* the batched input-tax statements the store was sent: [e, chitIds, roles, from, to] */
function loadWith(rows, posted, identity) {
  const dbPath = require.resolve(path.join(API, 'db')), tcPath = require.resolve(path.join(API, 'lib', 'tax-copy'));
  const handle = { query: async (sql, args) => { if (!/a\.role = ANY/.test(sql)) return { rows }; roleReads.push(args); return { rows: [].concat(...args[1].map((chit) => Object.entries((posted || {})[chit] || {}).map(([role, minor]) => ({ chit_id: chit, role, minor })))) }; } };
  require.cache[dbPath] = { exports: { query: async (sql) => ({ rows: /identities/.test(sql) ? [identity || IDENTITY, SUPPLIER_ROW] : [] }), withEntity: async (e, fn) => fn(handle) } };
  delete require.cache[tcPath];
  return require(tcPath);
}

(async () => {
  console.log('\n== ACC-269: GSTR-3B 4A reads an expense chit\'s posted input tax ==\n');
  const T = require(path.join(API, 'lib', 'tax-lines'));
  /* ACC-278: GSTR-3B is India's (gstrIndiaOnly refuses an AU/AE shop), so an AU/AE month's input credit is read from the ledger itself, not through the India form */
  const ledgerItc = (led) => led.ledger.itc;
  const itc = (led) => T.gstr3b(led.ledger, led.me, led.bounds.period).itc_elg.itc_net;
  const e1 = expense(1, { input_tax: { cgst: 9, sgst: 9 } });
  const posted1 = { [id(1)]: { input_cgst: 900, input_sgst: 900 } };

  const a = await loadWith([e1], posted1).ledgerFor(SHOP, month);
  ok('IN expense with cgst 9 + sgst 9 posted -> 4A cgst 9, sgst 9', itc(a).camt === 9 && itc(a).samt === 9 && itc(a).iamt === 0, JSON.stringify([itc(a), a.dropped_why]));
  ok('  and the expense is not named as unread', a.dropped.length === 0, JSON.stringify(a.dropped_why));

  const b = await loadWith([e1, bought(2)], posted1).ledgerFor(SHOP, month);
  ok('invoice ITC (9+9) + expense ITC (9+9) -> 4A 18 + 18, each once', itc(b).camt === 18 && itc(b).samt === 18, JSON.stringify(itc(b)));

  const twice = Object.assign(bought(3), { business_json: { invoice: invoice(100, 18), expense: { what: 'Repairs', mode: 'Cash', amount: 118, input_tax: { cgst: 9, sgst: 9 } } } }); /* the supplier's invoice AND an expense key: its tax is the invoice's, once */
  const c = await loadWith([bought(2), twice], { [id(3)]: { input_cgst: 900, input_sgst: 900 } }).ledgerFor(SHOP, month);
  ok('a chit that carries an invoice AND posted input tax is counted from the invoice only (not doubled)', itc(c).camt === 18 && itc(c).samt === 18, JSON.stringify(itc(c)));

  const inter = await loadWith([expense(4, { input_tax: { igst: 18 } })], { [id(4)]: { input_igst: 1800 } }).ledgerFor(SHOP, month);
  ok('inter-state expense: igst 18 -> 4A igst 18', itc(inter).iamt === 18 && itc(inter).camt === 0, JSON.stringify(itc(inter)));

  const none = await loadWith([expense(5, {})], {}).ledgerFor(SHOP, month);
  ok('an expense with no input tax posted changes nothing (4A stays 0)', itc(none).camt === 0 && itc(none).iamt === 0);

  /* review of #941: ONE read for the month, the month's bounds, only India */
  roleReads.length = 0;
  const many = await loadWith([expense(6, { input_tax: { cgst: 9, sgst: 9 } }), expense(7, { input_tax: { cgst: 9, sgst: 9 } }), expense(8, { input_tax: { igst: 18 } })], { [id(6)]: { input_cgst: 900, input_sgst: 900 }, [id(7)]: { input_cgst: 900, input_sgst: 900 }, [id(8)]: { input_igst: 1800 } }).ledgerFor(SHOP, month);
  ok('three expense chits in the month: ONE input-tax read (no N+1), bounded to the month', roleReads.length === 1 && roleReads[0][1].length === 3 && roleReads[0][3] === month + '-01', JSON.stringify(roleReads.map((x) => [x[1].length, x[3], x[4]])));
  ok('  and 4A is the three chits: cgst 18, sgst 18, igst 18', itc(many).camt === 18 && itc(many).samt === 18 && itc(many).iamt === 18, JSON.stringify(itc(many)));

  roleReads.length = 0;
  const noExpense = await loadWith([bought(2)], {}).ledgerFor(SHOP, month);
  ok('a month with no expense chit sends no input-tax read at all', roleReads.length === 0 && itc(noExpense).camt === 9);

  for (const country of ['AU', 'AE']) {
    roleReads.length = 0;
    const away = await loadWith([expense(9, { input_tax: { gst: 15 } })], { [id(9)]: { gst_paid: 1500 } }, Object.assign({}, IDENTITY, { country })).ledgerFor(SHOP, month);
    ok(country + ' shop: its expense is NOT read by this reader (BAS 1B / VAT201 read the posted ledger themselves): no read, ITC unchanged', roleReads.length === 0 && ledgerItc(away).cgst === 0 && ledgerItc(away).igst === 0, JSON.stringify(ledgerItc(away)));
  }

  /* the blocked credit: ACC-230 posts a head the books do not carry as input to COST, so no input_* line exists -> held out of 4A */
  const blocked = await loadWith([expense(10, { input_tax: { cgst: 9, sgst: 9 } })], { [id(10)]: {} }).ledgerFor(SHOP, month);
  ok('a blocked credit (its tax went to cost, no input line posted) is held out of 4A', itc(blocked).camt === 0 && itc(blocked).samt === 0, JSON.stringify(itc(blocked)));

  /* the rules of the store's statement, on the in-memory twin that mirrors it: reversed nets to 0 · the month boundary · a later reversal */
  const twin = require(path.join(API, 'tests', 'support', 'books-memory.cjs')).create();
  const T2 = twin.T;
  const acct = (account_id, role) => T2.accounts.push({ account_id, role });
  acct('ac-cgst', 'input_cgst'); acct('ac-sgst', 'input_sgst');
  const post = (n, date, ref, reverses) => { const entry_id = 'en-' + n; T2.entries.push({ entry_id, entity_id: SHOP, source_ref: ref, posting_date: date, reverses_entry_id: reverses || null });
    T2.lines.push({ entry_id, account_id: 'ac-cgst', dr_minor: reverses ? 0 : 900, cr_minor: reverses ? 900 : 0 }, { entry_id, account_id: 'ac-sgst', dr_minor: reverses ? 0 : 900, cr_minor: reverses ? 900 : 0 }); return entry_id; };
  const next = (m) => { const d = new Date(m.slice(0, 7) + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); return d.toISOString().slice(0, 10); };
  const from = month + '-01', to = next(month), roles = ['input_cgst', 'input_sgst'];
  post(1, from, 'chit:' + id(21)); post(2, from, 'chit:' + id(22));
  post(3, to, 'chit:' + id(23)); /* posted on the 1st of the NEXT month */
  post(4, from, 'chit:' + id(24)); post(5, from, 'chit:' + id(24), 'en-4'); /* 24 reversed in the month */
  post(6, from, 'chit:' + id(26)); post(7, to, 'chit:' + id(26), 'en-6'); /* 26 reversed only NEXT month: still in this month, as filed */
  const read = await twin.inputTaxOfChits(null, SHOP, [id(21), id(22), id(23), id(24), id(26)], roles, from, to);
  ok('twin of the statement: a posted expense is in its month', read[id(21)] && read[id(21)].input_cgst === 900 && read[id(22)].input_sgst === 900, JSON.stringify(read));
  ok('  an expense posted on the 1st of the next month is NOT in this month', !read[id(23)], JSON.stringify(read));
  ok('  a reversed expense nets to 0 (absent)', !read[id(24)], JSON.stringify(read));
  ok('  an expense reversed only in a LATER month is still in this month, as filed', read[id(26)] && read[id(26)].input_cgst === 900, JSON.stringify(read));
  const nextMonth = await twin.inputTaxOfChits(null, SHOP, [id(23), id(26)], roles, to, next(to));
  ok('  the next month holds the 1st-of-month posting, and not the reversed one', nextMonth[id(23)] && nextMonth[id(23)].input_cgst === 900 && !nextMonth[id(26)], JSON.stringify(nextMonth));

  /* AU BAS 1B: a read of the posted gst_paid ledger (gst-returns.returnFor) - this change does not touch it */
  const GR = require(path.join(API, 'lib', 'gst-returns'));
  const REG = require(path.join(API, 'lib', 'regulation'));
  const bas = GR.returnFor(REG.packFor('AU'), '2026-Q4', [{ role: 'gst_paid', dr_minor: 1500, cr_minor: 0 }, { role: 'sales', dr_minor: 0, cr_minor: 10000 }, { role: 'gst_collected', dr_minor: 0, cr_minor: 1000 }]);
  const box = (code) => ((bas.boxes || bas.rows || []).find((x) => x.code === code) || {}).amount_minor;
  ok('AU BAS 1B still reads the gst_paid ledger: 1500', box('1B') === 1500, JSON.stringify(bas).slice(0, 300));

  console.log('\n' + pass + ' passed, ' + fail + ' failed\n\n' + (pass + fail) + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
