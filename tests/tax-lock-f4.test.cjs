/**
 * tests/tax-lock-f4.test.cjs — F4 (VERIFY-GF-MONEY-SECURITY, batch 1128): A CLOSED TAX PERIOD IS NOT OPENED OR POSTED INTO SILENTLY. Real Express over the in-memory ledger (no database).
 * An Australian GST-registered shop, hand figures (minor units in brackets):
 *   Q1 (Jul–Sep 2026) sells 18,200.00 + GST 1,820.00 (182000) and buys 5,000.00 + GST 500.00 (50000) → set-off 500.00, payable 1,320.00 (132000).
 *   · a plain unlock of September (a month of the closed Q1) → 400 BOOKS_BAD_REQUEST in words, September stays soft-locked with the close's reason, nothing written
 *   · an entry typed into it is still refused (409 PERIOD_LOCKED); Q1 carries GST collected 1,320.00 before and after
 *   · the explicit amendment (unlock + amend_tax + reason) opens it; the change log says "Tax close amended — <reason>"
 *   · a month of NO closed period (Q2) unlocks plainly, exactly as before
 *   · year close then reopen of the year: the months of Q1 (closed by a set-off entry) come back SOFT-LOCKED with 'Tax period closed — ', a sale into September is refused; carried totals (GST collected) equal the hand figure
 * Needs the books engines (BOOKS_ENGINES_SRC or the sibling ../chitbridge-engines/src). Run: node tests/tax-lock-f4.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const AU = 'aaaaaaaa-8888-4111-8111-111111111111', SUPP = 'bbbbbbbb-8888-4111-8111-111111111111';
const authStub = Object.assign((req, res, next) => { req.identity = { identity_id: AU, identity_type: 'entity', display_name: 'Bondi Grocer' }; next(); }, {
  entityOf: (req) => req.identity.identity_id,
  requireScope: () => (req, res, next) => next(),
});
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { j = { raw }; } done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});

(async () => {
  console.log('\n== F4: a closed tax period cannot be unlocked or posted into silently ==\n');
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  X.T.identities.push({ identity_id: AU, gstn: '51824753556', display_name: 'Bondi Grocer', country: 'AU', policy_flags: { gst_registration: 'regular' } });
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/books' + p, b);
  let DAY = '2026-10-20'; const realDay = K.dayOf;
  K.dayOf = (ts, c) => (ts instanceof Date && Math.abs(ts.getTime() - Date.now()) < 5000 ? DAY : realDay(ts, c));
  const FY = '2026-27';
  const rowOf = (p) => X.T.periods.find((r) => r.entity_id === AU && r.fiscal_year === FY && Number(r.period) === p);
  /* GST collected as at a day: the credit side of the collected account for entries dated up to it (the return reads the books by date) */
  const gstCollected = (upTo) => { const code = (X.T.accounts.find((a) => a.entity_id === AU && a.role === 'gst_collected') || {}).code; const dated = (l) => { const e = X.T.entries.find((x) => x.entry_id === l.entry_id); return !upTo || String(e.posting_date).slice(0, 10) <= upTo; }; return X.T.lines.filter((l) => l.entity_id === AU && l.code === code && dated(l)).reduce((s, l) => s + Number(l.cr_minor) - Number(l.dr_minor), 0); };
  const Q1END = '2026-09-30';
  const lockedPost = (date, ref) => q('POST', '/loans', { ref, lender: 'X', amount_minor: 100, into: 'bank', date }); /* a typed date in a locked month is refused PERIOD_LOCKED (books-period.test.cjs) */
  const sale = (date, taxable, tax, ref) => X.B.postEntry(X.db, AU, { type: 'walkin_day', ref, date, currency: 'AUD', modes: { cash: taxable + tax }, by_rate: [{ rate: 10, taxable, gst: tax }] });
  const changes = () => X.T.changes.filter((c) => c.table_name === 'fiscal_period');

  await X.store.saveSetting(X.db, AU, { enabled: false, country: 'AU' });
  ok('AU: the ledger is on', (await q('POST', '/enable', {})).body.ok === true);
  X.T.parties.push({ owner: AU, party_id: SUPP, party_no: 'P-00001', name: 'Metcash', supplier: true, credit_days: 30 });
  await sale('2026-08-10', 18200, 1820, 'S1');
  await X.B.postEntry(X.db, AU, { type: 'purchase_bill', ref: 'P1', date: '2026-08-12', currency: 'AUD', party: SUPP, by_rate: [{ rate: 10, taxable: 5000, gst: 500 }], paid: 0 });
  const close = await q('POST', '/gst/close', { period: '2026-Q1', client_ref: 'q1' });
  eq('Q1 closes with the set-off 500.00 and 1,320.00 payable (hand: 1820 - 500)', [close.status, close.body.ok, close.body.payable_minor, close.body.utilised && close.body.utilised[0].amount_minor], [200, true, { gst_minor: 132000 }, 50000]);
  eq('…GST collected carried 1,820.00 (182000) less the set-off 500.00 = 1,320.00 (132000)', gstCollected(), 132000);
  ok('…September is soft-locked with the close\'s own reason', rowOf(3).status === 'soft_locked' && /^Tax period closed — /.test(rowOf(3).reason), JSON.stringify(rowOf(3)));

  /* 1 · a plain unlock is refused, in words, and writes nothing */
  const logs0 = changes().length;
  const plain = await q('POST', '/periods/' + FY + '/3/unlock', { reason: 'typo' });
  ok('a plain unlock of September → 400 in words (a closed tax period, amend it)', plain.status === 400 && /closed tax period/.test(plain.body.message) && /amend/i.test(plain.body.message), JSON.stringify(plain.body));
  ok('…September stays soft-locked, nothing was logged', rowOf(3).status === 'soft_locked' && /^Tax period closed — /.test(rowOf(3).reason) && changes().length === logs0, JSON.stringify(rowOf(3)));
  const entries0 = X.T.entries.length, before = gstCollected(Q1END);
  const strict = await lockedPost('2026-09-10', 'strict-sep');
  ok('…an entry typed into September is refused as a locked month (409 PERIOD_LOCKED), nothing posted', strict.status === 409 && strict.body.code === 'PERIOD_LOCKED' && X.T.entries.length === entries0, JSON.stringify(strict.body));
  eq('…Q1 carries the same GST collected before and after (132000)', [before, gstCollected(Q1END)], [132000, 132000]);

  /* 2 · the explicit amendment is the only way, and it says so in the trail */
  const amend = await q('POST', '/periods/' + FY + '/3/unlock', { reason: 'typo in September', amend_tax: true });
  ok('unlock + amend_tax + reason → 200, September open', amend.status === 200 && amend.body.ok === true && rowOf(3).status === 'open', JSON.stringify(amend.body));
  ok('…the change log says it was an amendment, with the reason', changes().some((c) => String(c.new).indexOf('Tax close amended — typo in September') >= 0), JSON.stringify(changes().slice(-2)));
  const noReason = await q('POST', '/periods/' + FY + '/2/unlock', { amend_tax: true });
  await sale('2026-09-10', 1000, 100, 'S2');
  eq('…the amended September takes a A$1,100.00 sale (GST 100.00): Q1 now carries 1,420.00 (hand 1,320.00 + 100.00 = 142000) — the figure the explicit amendment exists to name', gstCollected(Q1END), 142000);
  ok('an amendment without a reason is refused (400/422), August stays locked', noReason.status >= 400 && rowOf(2).status === 'soft_locked', JSON.stringify(noReason.body));

  /* 3 · a month of no closed period opens plainly, as before */
  await q('POST', '/periods/' + FY + '/4/lock', { reason: 'October done' });
  const plainOpen = await q('POST', '/periods/' + FY + '/4/unlock', { reason: 'one more bill' });
  ok('October (Q2, not closed) locks and unlocks plainly (200)', plainOpen.status === 200 && rowOf(4).status === 'open', JSON.stringify(plainOpen.body));

  /* 4 · year close, then the year reopened: the Q1 lock outlives the year close */
  await q('POST', '/periods/' + FY + '/3/lock', { reason: 'locked again' });
  DAY = '2027-07-10';
  for (const period of ['2026-Q2', '2027-Q3', '2027-Q4']) { const r = await q('POST', '/gst/close', { period, client_ref: period }); ok(period + ' closes (nothing to set off)', r.status === 200 && r.body.ok === true, JSON.stringify(r.body)); }
  const yc = await q('POST', '/year/' + FY + '/close', {});
  ok('the year closes (200), no depreciation owed (no asset register)', yc.status === 200 && yc.body.ok === true, JSON.stringify(yc.body));
  const ro = await q('POST', '/year/' + FY + '/reopen', { reason: 'late correction' });
  ok('the year reopens (200) and says how many months the tax close kept locked: 3 (July, August, September)', ro.status === 200 && ro.body.ok === true, JSON.stringify(ro.body));
  ok('…Q1 months are soft-locked with the tax close words again (the reopen no longer overwrites them)', [1, 2, 3].every((p) => rowOf(p).status === 'soft_locked' && /^Tax period closed — /.test(rowOf(p).reason)), JSON.stringify([1, 2, 3].map(rowOf)));
  const entries1 = X.T.entries.length, q1 = gstCollected(Q1END);
  const strict2 = await lockedPost('2026-09-12', 'strict-sep-2');
  ok('…an entry typed into September after the reopen is still refused (409 PERIOD_LOCKED), nothing posted', strict2.status === 409 && strict2.body.code === 'PERIOD_LOCKED' && X.T.entries.length === entries1, JSON.stringify(strict2.body));
  eq('…Q1 still carries the same GST collected (142000 before = after)', [q1, gstCollected(Q1END)], [142000, 142000]);
  srv.close();
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
