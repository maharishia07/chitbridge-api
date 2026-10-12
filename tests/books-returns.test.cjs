/**
 * books-returns.test.cjs — BAS1 (2026-10-12): GET /api/books/returns — the shop's OWN return, PREPARED FROM ITS BOOKS, through real Express over the
 * in-memory ledger (no database). An Australian shop gets its BAS, a UAE shop its VAT201, an Indian shop is told its GSTR comes from the rail.
 *
 * Proves: the period table is the pack's (AU quarters due the 28th, AE staggers due the 28th — never guessed) · the chosen period defaults to the latest that ended ·
 * every box is a READ of the posted books — BAS 1A − 1B equals the GST ledgers' net movement for the quarter, summed here from the journal lines themselves (the
 * brief's proof, on real postings) · a month outside the period does not count · Simpler BAS by default, the full BAS on request · every box names the ledgers it
 * counts (roles → the shop's chart) · VAT201 Boxes 1 · 9 · 14 from AED postings, the Emirate said, the FTA's boxes null and said · refusals in words (no stagger,
 * a bad Emirate) · owner only (a co-assist 403) · India 422 RETURN_FROM_RAIL.
 * Needs the books engines (the sibling ../chitbridge-engines/src at v1.39.0, or BOOKS_ENGINES_SRC). Run: node tests/books-returns.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const AU = 'aaaaaaaa-1111-4111-8111-111111111111', AE = 'eeeeeeee-1111-4111-8111-111111111111', IN = '11111111-1111-4111-8111-111111111111', SUPP = '33333333-3333-4333-8333-333333333333';
const owner = (id, name) => ({ identity_id: id, identity_type: 'entity', display_name: name });
const STAFF = { identity_id: '44444444-4444-4444-8444-444444444444', parent_entity_id: AU, identity_type: 'actor' };
let WHO = owner(AU, 'Bondi Grocer');
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
  console.log('\n══ GET /api/books/returns — BAS (AU) · VAT201 (AE) prepared from the books; India from the rail ══\n');
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  const IDS = {
    [AU]: { identity_id: AU, gstn: null, display_name: 'Bondi Grocer', country: 'AU', policy_flags: {} },
    [AE]: { identity_id: AE, gstn: null, display_name: 'Deira Stores', country: 'AE', policy_flags: {} },
    [IN]: { identity_id: IN, gstn: '33AAAAA0000A1Z5', display_name: 'Mayur Traders', country: 'IN', policy_flags: {} },
  };
  const q0 = X.dbStub.query;
  X.dbStub.query = async (t, p) => /FROM identities WHERE identity_id = ANY/.test(String(t)) ? { rows: p[0].map((id) => IDS[id]).filter(Boolean) } : q0(t, p);
  for (const m of ['tax-copy', 'bill-use']) delete require.cache[require.resolve(path.join(H.API, 'lib', m))];
  require.cache[require.resolve(path.join(H.API, 'lib', 'storage-object'))] = { exports: { available: async () => false } };
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/books' + p, b);
  let DAY = '2026-10-20'; const realDay = K.dayOf;
  K.dayOf = (ts, c) => (ts instanceof Date && Math.abs(ts.getTime() - Date.now()) < 5000 ? DAY : realDay(ts, c));   /* only "now" moves */

  const codeOfRole = (shop, role) => (X.T.accounts.find((a) => a.entity_id === shop && a.role === role) || {}).code;
  /** the ledger's net movement between two dates, summed HERE from the journal lines — independent of the route and of the engine */
  const moved = (shop, role, from, to, side) => {
    const acct = X.T.accounts.find((a) => a.entity_id === shop && a.role === role); if (!acct) return 0;
    return X.T.lines.filter((l) => l.entity_id === shop && l.account_id === acct.account_id).reduce((t, l) => {
      const e = X.T.entries.find((x) => x.entry_id === l.entry_id), d = String(e.posting_date).slice(0, 10);
      if (d < from || d > to) return t;
      return t + (side === 'cr' ? Number(l.cr_minor) - Number(l.dr_minor) : Number(l.dr_minor) - Number(l.cr_minor));
    }, 0);
  };
  const box = (r, code) => (r.body.boxes || []).find((b) => b.code === String(code)) || {};

  /* ── an Australian shop: the ledger on under the AU pack; July · August · September sales and a September purchase (Q1), an October sale (Q2) ── */
  await X.store.saveSetting(X.db, AU, { enabled: false, country: 'AU' });
  const en = await q('POST', '/enable', {});
  ok('AU: the ledger is on — the AU pack, AUD, the year from July', en.status === 200 && en.body.ok && en.body.fiscal_year === '2026-27' && codeOfRole(AU, 'gst_collected') === '2200', JSON.stringify(en.body));
  X.T.parties.push({ owner: AU, party_id: SUPP, party_no: 'P-00001', name: 'Metcash', supplier: true, credit_days: 30 });
  const day = (shop, cur, date, taxable, tax, head, ref) => X.B.postEntry(X.db, shop, { type: 'walkin_day', ref, date, currency: cur, modes: { cash: taxable + tax }, by_rate: [Object.assign({ rate: cur === 'AUD' ? 10 : 5, taxable }, { [head]: tax })], round_off: 0, source_ref: 'walkin:C1:' + date });
  const buy = (shop, cur, date, taxable, tax, head, ref) => X.B.postEntry(X.db, shop, { type: 'purchase_bill', ref, date, currency: cur, party: SUPP, by_rate: [Object.assign({ rate: cur === 'AUD' ? 10 : 5, taxable }, { [head]: tax })], paid: {}, round_off: 0, source_ref: 'pur:' + ref });
  await day(AU, 'AUD', '2026-07-01', 100, 10, 'gst', 'D1');
  await day(AU, 'AUD', '2026-08-15', 200, 20, 'gst', 'D2');
  await buy(AU, 'AUD', '2026-09-06', 500, 50, 'gst', 'P1');
  await day(AU, 'AUD', '2026-10-03', 400, 40, 'gst', 'D3');

  let r = await q('GET', '/returns');
  ok('GET /returns (AU) → 200, the pack\'s own words: BAS · Business activity statement · ATO · prepared, not lodged', r.status === 200 && r.body.form === 'BAS' && r.body.short === 'BAS' && r.body.authority === 'ATO' && r.body.prepared === 'Prepared, not lodged' && r.body.currency === 'AUD', JSON.stringify(r.body).slice(0, 300));
  eq('the period table is the pack\'s: two financial years of quarters, due the 28th (Q4 due 28 July next year)', r.body.periods.map((p) => p.period + '→' + p.due),
    ['2025-Q1→2025-10-28', '2025-Q2→2026-02-28', '2026-Q3→2026-04-28', '2026-Q4→2026-07-28', '2026-Q1→2026-10-28', '2026-Q2→2027-02-28', '2027-Q3→2027-04-28', '2027-Q4→2027-07-28']);
  ok('the chosen period defaults to the latest that has ended: 2026-Q1 (Jul–Sep 2026), ended; Q2 is not', r.body.period.period === '2026-Q1' && r.body.period.ended === true && r.body.periods.find((p) => p.period === '2026-Q2').ended === false, JSON.stringify(r.body.period));
  eq('Simpler BAS by default: G1 · 1A · 1B · 9', r.body.boxes.map((b) => b.code), ['G1', '1A', '1B', '9']);
  eq('1A = GST on the quarter\'s sales (10 + 20 = 30.00) · 1B = GST on its purchases (50.00) · 9 = −20.00 → a refund; October is not in it', [box(r, '1A').amount_minor, box(r, '1B').amount_minor, box(r, '9').amount_minor, r.body.payable_minor, r.body.refund_minor, r.body.net_minor], [3000, 5000, -2000, 0, 2000, -2000]);
  eq('G1 is GST inclusive: sales 300.00 + 1A 30.00', box(r, 'G1').amount_minor, 33000);
  const net = moved(AU, 'gst_collected', '2026-07-01', '2026-09-30', 'cr') - moved(AU, 'gst_paid', '2026-07-01', '2026-09-30', 'dr');
  ok('⭐ BAS 1A − 1B = the GST ledgers\' net movement for the quarter, summed from the journal lines themselves (' + net + ')', net === box(r, '1A').amount_minor - box(r, '1B').amount_minor && net === -2000, 'lines say ' + net);
  eq('every box names the ledgers it counts: 1A → 2200 GST collected · 1B → 2210 GST paid · 9 → both', [box(r, '1A').accounts.map((a) => a.code), box(r, '1B').accounts.map((a) => a.code), box(r, '9').accounts.map((a) => a.code), box(r, '1A').roles],
    [['2200'], [codeOfRole(AU, 'gst_paid')], ['2200', codeOfRole(AU, 'gst_paid')], ['gst_collected']]);
  ok('the ledger names ride with the codes', box(r, '1A').accounts[0].name === 'GST collected' && box(r, 'G1').accounts.some((a) => a.code === codeOfRole(AU, 'sales')), JSON.stringify(box(r, '1A').accounts));
  ok('the notes say Simpler BAS; the cite is the ATO page', r.body.notes.some((n) => /Simpler BAS/.test(n)) && /ato.gov.au/.test(r.body.cite), JSON.stringify(r.body.notes));

  r = await q('GET', '/returns?simpler=0');
  eq('the full BAS on request: G1 G2 G3 G10 G11 1A 1B 9; G11 = the quarter\'s purchases 500.00, G10 nil', [r.body.boxes.map((b) => b.code), box(r, 'G11').amount_minor, box(r, 'G10').amount_minor, r.body.asked.simpler],
    [['G1', 'G2', 'G3', 'G10', 'G11', '1A', '1B', '9'], 50000, 0, false]);
  ok('G10 / G11 carry their basis (GST-exclusive) as the note', /GST-exclusive/.test(box(r, 'G11').note));
  r = await q('GET', '/returns?period=2026-Q2');
  eq('a period asked by name: Q2 holds the October day only (1A 40.00), not yet ended', [r.body.period.period, r.body.period.ended, box(r, '1A').amount_minor, box(r, '1B').amount_minor], ['2026-Q2', false, 4000, 0]);
  r = await q('GET', '/returns?frequency=monthly&period=2026-07');
  eq('monthly BAS: July alone (1A 10.00), due the 21st of August, twenty-four months listed', [r.body.period.period, r.body.period.due, box(r, '1A').amount_minor, r.body.periods.length, r.body.asked.frequency], ['2026-07', '2026-08-21', 1000, 24, 'monthly']);
  r = await q('GET', '/returns?period=2031-Q9');
  ok('an unknown period name falls back to the latest ended, never a 500', r.status === 200 && r.body.period.period === '2026-Q1');
  WHO = STAFF; r = await q('GET', '/returns'); WHO = owner(AU, 'Bondi Grocer');
  ok('OWNER ONLY: a co-assist is refused (403)', r.status === 403, String(r.status));

  /* ── a UAE shop: the ledger on under the AE pack; a March day and an April purchase (stagger 1: Feb–Apr) ── */
  WHO = owner(AE, 'Deira Stores'); DAY = '2026-06-10';
  await X.store.saveSetting(X.db, AE, { enabled: false, country: 'AE' });
  const en2 = await q('POST', '/enable', {});
  ok('AE: the ledger is on — the AE pack, AED, the calendar year', en2.status === 200 && en2.body.ok && codeOfRole(AE, 'output_vat') === '2200' && codeOfRole(AE, 'input_vat') === '2210', JSON.stringify(en2.body));
  X.T.parties.push({ owner: AE, party_id: SUPP, party_no: 'P-00001', name: 'Al Maya', supplier: true, credit_days: 30 });
  await day(AE, 'AED', '2026-03-01', 100, 5, 'vat', 'D1');
  await buy(AE, 'AED', '2026-04-02', 400, 20, 'vat', 'P1');
  await day(AE, 'AED', '2026-05-20', 60, 3, 'vat', 'D2');
  r = await q('GET', '/returns');
  ok('GET /returns (AE) without the FTA stagger → 200 and `needs: stagger` with the pack\'s sentence; no period, no box — nothing is guessed', r.status === 200 && r.body.needs === 'stagger' && /FTA assigns the Tax Period/.test(r.body.why) && r.body.periods.length === 0 && r.body.boxes.length === 0 && r.body.form === 'VAT201' && r.body.short === 'VAT return' && r.body.authority === 'FTA', JSON.stringify(r.body).slice(0, 300));
  r = await q('GET', '/returns?stagger=1&emirate=Dubai');
  ok('with stagger 1 and the Emirate: 200, the latest ended period is Feb–Apr 2026, due 28 May; eight periods over two years', r.status === 200 && r.body.period.period === '2026-02/2026-04' && r.body.period.due === '2026-05-28' && r.body.periods.length === 8 && r.body.asked.stagger === 1 && r.body.asked.emirate === 'Dubai', JSON.stringify(r.body.period));
  eq('fifteen boxes, in the form\'s order', r.body.boxes.map((b) => b.code), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15']);
  eq('Box 1 = the period\'s standard-rated sales 100.00, VAT 5.00, under Dubai · Box 9 = expenses 400.00, VAT 20.00 · Box 14 = 5.00 − 20.00 = −15.00 → refund; May is not in it',
    [box(r, 1).amount_minor, box(r, 1).tax_minor, box(r, 1).note, box(r, 9).amount_minor, box(r, 9).tax_minor, box(r, 12).tax_minor, box(r, 13).tax_minor, box(r, 14).tax_minor, r.body.refund_minor, r.body.payable_minor],
    [10000, 500, 'Emirate: Dubai', 40000, 2000, 500, 2000, -1500, 1500, 0]);
  const netAE = moved(AE, 'output_vat', '2026-02-01', '2026-04-30', 'cr') - moved(AE, 'input_vat', '2026-02-01', '2026-04-30', 'dr');
  ok('⭐ Box 14 = the VAT ledgers\' net movement for the period, summed from the journal lines (' + netAE + ')', netAE === box(r, 14).tax_minor);
  ok('the FTA\'s boxes (2 · 6 · 7) are null and say why; Box 15 is the shop\'s choice', [2, 6, 7].every((n) => box(r, n).amount_minor === null && /not read from the ledgers/.test(box(r, n).note)) && box(r, 15).tax_minor === null);
  eq('Box 1 opens Sales, Sales returns and Output VAT; Box 14 opens the three VAT ledgers in the form\'s order (due tax, then recoverable)', [box(r, 1).accounts.map((a) => a.code), box(r, 14).accounts.map((a) => a.name)],
    [[codeOfRole(AE, 'sales'), codeOfRole(AE, 'sales_returns'), '2200'], ['Output VAT', 'VAT due under reverse charge', 'Input VAT']]);
  ok('the seven Emirates ride along for the picker; the notes say the Emirate basis and the Box 9 basis; the cite is the FTA guide', r.body.emirates.length === 7 && r.body.notes.some((n) => /Dubai/.test(n)) && r.body.notes.some((n) => /VAT-exclusive/.test(n)) && /FTA VAT Returns guide/.test(r.body.cite));
  r = await q('GET', '/returns?stagger=1&emirate=Doha');
  ok('a bad Emirate is refused in the pack\'s words (422)', r.status === 422 && /one of Abu Dhabi, Dubai/.test(r.body.message), JSON.stringify(r.body));
  r = await q('GET', '/returns?stagger=monthly');
  ok('a monthly stagger: twenty-four months, May 2026 the latest ended (3.00 of output VAT)', r.status === 200 && r.body.periods.length === 24 && r.body.period.period === '2026-05' && box(r, 1).tax_minor === 300, JSON.stringify(r.body.period));

  /* ── an Indian shop: its return is the GSTR, read from the rail ── */
  WHO = owner(IN, 'Mayur Traders'); DAY = '2026-10-20';
  await X.store.saveSetting(X.db, IN, { enabled: false });
  await q('POST', '/enable', {});
  r = await q('GET', '/returns');
  ok('IN → 422 RETURN_FROM_RAIL, in words (GSTR-1 / 3B come from the frozen invoices on the rail: GET /api/tax/gstr)', r.status === 422 && r.body.code === 'RETURN_FROM_RAIL' && /GET \/api\/tax\/gstr/.test(r.body.message), JSON.stringify(r.body));

  srv.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
