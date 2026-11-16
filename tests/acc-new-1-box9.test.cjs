/**
 * tests/acc-new-1-box9.test.cjs — ACC-new-1 (l16-accfix, from the e2e money test 16 Nov): THE VAT201 BOX 9 COUNTS ONLY THE PURCHASES THAT CARRIED RECOVERABLE VAT.
 * Through real Express over the in-memory ledger (no database). A UAE shop (stagger 1, Feb-Apr 2026) buys 600.00 + 30.00 VAT from a registered supplier (P1), 300.00 with no
 * VAT from an unregistered one (P2), pays an electricity bill 150.00 + 7.50 VAT (E1) and a bank fee 12.50 with no VAT:
 *   hand: Box 9 amount = 600.00 + 150.00 = 750.00 (before: 1,062.50, the whole purchase and expense accounts) · Box 9 VAT = 30.00 + 7.50 = 37.50.
 *   a reversal has its own clause: reversing P1 takes its 600.00 out of Box 9 (the reversal carries the same VAT line, so it nets away).
 *   Carried totals are compared (Box 9 VAT with the Input VAT ledger's movement), never computed twice.
 * AU is the control: its G11 (full BAS) is NOT changed here (a rule question for cb-country): it still reads the whole purchase and expense accounts.
 * IN has no ledger-read return (GSTR is read from the rail, RETURN_FROM_RAIL), so the narrowing does not apply to it; the pack says so by having no returns.taxedOnly.
 * Needs the books engines (BOOKS_ENGINES_SRC or the sibling ../chitbridge-engines/src). Run: node tests/acc-new-1-box9.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const AU = 'aaaaaaaa-5555-4111-8111-111111111111', AE = 'eeeeeeee-5555-4111-8111-111111111111', SUPP = '33333333-3333-4333-8333-333333333333';
const owner = (id, name) => ({ identity_id: id, identity_type: 'entity', display_name: name });
let WHO = owner(AE, 'Deira Stores');
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
  console.log('\n══ VAT201 Box 9 counts only the purchases that carried recoverable VAT (ACC-new-1) ══\n');
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  const IDS = {
    [AU]: { identity_id: AU, gstn: null, display_name: 'Bondi Grocer', country: 'AU', policy_flags: {} },
    [AE]: { identity_id: AE, gstn: null, display_name: 'Deira Stores', country: 'AE', policy_flags: {} },
  };
  const q0 = X.dbStub.query;
  X.dbStub.query = async (t, p) => /FROM identities WHERE identity_id = ANY/.test(String(t)) ? { rows: p[0].map((id) => IDS[id]).filter(Boolean) } : q0(t, p);
  for (const m of ['tax-copy', 'bill-use']) delete require.cache[require.resolve(path.join(H.API, 'lib', m))];
  require.cache[require.resolve(path.join(H.API, 'lib', 'storage-object'))] = { exports: { available: async () => false } };
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/books' + p, b);
  let DAY = '2026-06-10'; const realDay = K.dayOf;
  K.dayOf = (ts, c) => (ts instanceof Date && Math.abs(ts.getTime() - Date.now()) < 5000 ? DAY : realDay(ts, c));
  const box = (r, code) => (r.body.boxes || []).find((b) => b.code === String(code)) || {};
  const codeOf = (shop, role) => (X.T.accounts.find((a) => a.entity_id === shop && a.role === role) || {}).code;
  const moved = (shop, role, from, to) => {
    const acct = X.T.accounts.find((a) => a.entity_id === shop && a.role === role); if (!acct) return 0;
    return X.T.lines.filter((l) => l.entity_id === shop && l.account_id === acct.account_id).reduce((t, l) => {
      const e = X.T.entries.find((x) => x.entry_id === l.entry_id), d = String(e.posting_date).slice(0, 10);
      return d < from || d > to ? t : t + Number(l.dr_minor) - Number(l.cr_minor);
    }, 0);
  };
  const buy = (shop, cur, date, taxable, tax, head, ref, rate) => X.B.postEntry(X.db, shop, { type: 'purchase_bill', ref, date, currency: cur, party: SUPP, by_rate: [Object.assign({ rate, taxable }, tax ? { [head]: tax } : {})], paid: {}, round_off: 0, source_ref: 'pur:' + ref });
  const journal = (shop, cur, date, lines, ref) => X.B.postEntry(X.db, shop, { type: 'manual', owner: true, date, currency: cur, narration: ref, source_ref: 'k:' + ref, lines });

  /* ── the UAE shop ── */
  WHO = owner(AE, 'Deira Stores');
  await X.store.saveSetting(X.db, AE, { enabled: false, country: 'AE' });
  ok('AE: the ledger is on', (await q('POST', '/enable', {})).body.ok === true);
  X.T.parties.push({ owner: AE, party_id: SUPP, party_no: 'P-00001', name: 'Al Maya', supplier: true, credit_days: 30 });
  const p1 = await buy(AE, 'AED', '2026-04-02', 600, 30, 'vat', 'P1', 5);
  await buy(AE, 'AED', '2026-04-03', 300, 0, 'vat', 'P2', 0);
  await journal(AE, 'AED', '2026-04-05', [{ account: codeOf(AE, 'electricity'), dr: 150 }, { account: codeOf(AE, 'input_vat'), dr: 7.5 }, { account: codeOf(AE, 'bank'), cr: 157.5 }], 'E1');
  await journal(AE, 'AED', '2026-04-07', [{ account: codeOf(AE, 'bank_charges'), dr: 12.5 }, { account: codeOf(AE, 'bank'), cr: 12.5 }], 'FEE');
  const whole = ['purchases', 'electricity', 'bank_charges'].reduce((t, role) => t + moved(AE, role, '2026-02-01', '2026-04-30'), 0);
  eq('the books hold 600 + 300 + 150 + 12.50 = 1,062.50 on the purchase and expense accounts (what box 9 read before)', whole, 106250);

  let r = await q('GET', '/returns?stagger=1&emirate=Dubai&period=2026-02/2026-04');
  ok('GET /returns (AE) answers the Feb-Apr period', r.status === 200 && r.body.period && r.body.period.period === '2026-02/2026-04', JSON.stringify(r.body).slice(0, 200));
  eq('⭐ Box 9 amount = 750.00 (P1 600 + electricity 150: only what carried VAT), not 1,062.50', box(r, 9).amount_minor, 75000);
  eq('Box 9 VAT = 37.50 and equals the Input VAT ledger movement of the period (two carried totals)', [box(r, 9).tax_minor, moved(AE, 'input_vat', '2026-02-01', '2026-04-30')], [3750, 3750]);
  ok('the note says what Box 9 counts', /counting only the purchases and expenses that carried recoverable VAT/.test(box(r, 9).note || (r.body.notes || []).join(' ')), JSON.stringify(r.body.notes));
  eq('Box 11 total amount follows Box 9 (750.00)', box(r, 11).amount_minor, 75000);

  /* a reversal has its own clause: reversing P1 takes its 600.00 (and its 30.00 VAT) out */
  await X.B.reverseEntry(X.db, AE, p1.entry_id || (p1.entry && p1.entry.entry_id), { reason: 'wrong bill', by: AE });
  r = await q('GET', '/returns?stagger=1&emirate=Dubai&period=2026-02/2026-04');
  eq('after reversing P1: Box 9 amount = 150.00 and VAT = 7.50 (the reversal carries the VAT line, so it nets away)', [box(r, 9).amount_minor, box(r, 9).tax_minor], [15000, 750]);

  /* ── AU is the control: G11 of the full BAS is NOT changed ── */
  WHO = owner(AU, 'Bondi Grocer');
  await X.store.saveSetting(X.db, AU, { enabled: false, country: 'AU' });
  ok('AU: the ledger is on', (await q('POST', '/enable', {})).body.ok === true);
  await buy(AU, 'AUD', '2026-07-10', 100, 10, 'gst', 'A1', 10);
  await buy(AU, 'AUD', '2026-07-11', 50, 0, 'gst', 'A2', 0);
  DAY = '2026-11-10';
  r = await q('GET', '/returns?simpler=0&period=2026-Q1');
  ok('AU G11 answers (full BAS)', r.status === 200 && box(r, 'G11').code === 'G11', JSON.stringify(r.body).slice(0, 200));
  eq('AU G11 is unchanged: it still reads the whole purchase account (100.00 taxed + 50.00 untaxed = 150.00)', box(r, 'G11').amount_minor, 15000);
  ok('AU pack declares no taxedOnly member', require(path.join(H.API, 'lib', 'country')).packFor('AU').returns.taxedOnly === undefined && Array.isArray(require(path.join(H.API, 'lib', 'country')).packFor('AE').returns.taxedOnly));
  srv.close();
  console.log('\n' + pass + ' ok, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
