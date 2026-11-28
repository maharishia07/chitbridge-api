#!/usr/bin/env node
// @type: unit
/**
 * tests/acc418-write-off-recover.test.cjs — ACC-418: POST /api/books/write-off/recover posts the engine's write_off_recovery event once per client_ref; the route never computes GST.
 * OWNS      the door's scenario: a written-off bill of 99.00 (90.00 + GST 9.00) recovered in full: Dr bank 99.00 · Cr bad debts 90.00 · Cr GST 9.00; part-recovered 49.50: 45.00 and 4.50 (the engine's split, read from the invoice's own figures); no invoice named keeps the whole amount in bad debts.
 *           Also the door's wiring (the event the route hands the engine, the same ref twice is one entry, a changed amount under the same ref is 409, owner only) and that the route text holds no tax arithmetic.
 * CALLED BY scripts/guards.cjs · CI. The in-memory ledger of tests/support/books-harness.cjs; the engines come from BOOKS_ENGINES_SRC / CB_ENGINES_DIR / the sibling clone. The figure checks need the engines release that carries posting write_off_recovery (engines #165); on an older engine they are named as waiting, never silently passed.
 * FLOW      POST /write-off/recover → lib/books-bad-debt.adjusted (stood in: the invoice read is tests/acc418-bad-debt.test.cjs's) → books.postEntry → engine posting → lines
 * CARD      14-accounting/README
 */
'use strict';
const path = require('path'), http = require('http'), fs = require('fs');
const H = require('./support/books-harness.cjs');
let pass = 0, fail = 0, waiting = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const SHOP = '11111111-1111-4111-8111-111111111111', INV = '0a1b2c3d-0000-4000-8000-000000000001';
const AU = { enabled: true, walkin_grain: 'day', country: 'AU', functional_currency: 'AUD', fy_start_month: 7 };
let who = { identity_id: SHOP, identity_type: 'entity', display_name: 'Chola Auto Care' };
const authStub = Object.assign((req, res, next) => { req.identity = who; next(); }, { entityOf: () => SHOP, requireScope: () => (req, res, next) => next() });
let attempts = 0;
const post = (port, p, body) => new Promise((done) => {
  const b = JSON.stringify(body);
  const r = http.request({ host: '127.0.0.1', port, path: '/api/books' + p, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b), 'Idempotency-Key': 'wr-' + ++attempts } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { /* read as {} */ } done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});
(async () => {
  if (!H.enginesSrc().dir) { console.log('   SKIP: ' + H.enginesSrc().why); process.exit(1); }
  const X = H.load({ auth: authStub });
  const engineKnows = (() => { try { return typeof require(path.join(H.enginesSrc().dir, 'posting-bad-debt')).rules === 'function'; } catch (_) { return false; } })();
  const express = require('express'), app = express(); app.use(express.json());
  app.use('/api/books', require(path.join(H.API, 'routes', 'books'))); app.use('/api/books', require(path.join(H.API, 'routes', 'books-money'))); app.use('/api/books', require(path.join(H.API, 'routes', 'books-write-off-recover')));
  const srv = app.listen(0), q = (b) => post(srv.address().port, '/write-off/recover', b);
  await post(srv.address().port, '/enable', {});
  X.T.setting.set(SHOP, Object.assign({}, X.T.setting.get(SHOP) || {}, AU));
  /* the invoice read stands in: invoice 90.00 + GST 9.00 = 99.00 (its own reader is tested in acc418-bad-debt) */
  const bad = require(path.join(H.API, 'lib', 'books-bad-debt'));
  const realAdjusted = bad.adjusted;
  bad.adjusted = async (entity, event) => ({ event: Object.assign({}, event, event.against_ref ? { invoice: { gross_minor: 9900, tax_minor: 900 } } : {}), note: null });
  const seen = [], realPost = X.B.postEntry;
  X.B.postEntry = async (db, e, event, guard) => { seen.push(event); return realPost.call(X.B, db, e, event, guard); };
  const movement = (out) => (X.T.lines || X.T.journal_lines || []).filter((l) => l.entry_id === out.body.entry_id).map((l) => Number(l.dr_minor || 0) - Number(l.cr_minor || 0)).sort((a, b) => a - b);

  const full = await q({ amount_minor: 9900, reason: 'paid at last', into: 'bank', against_ref: INV, client_ref: 'wr-full', date: '2026-11-20' });
  ok('wiring: the route hands the engine a write_off_recovery event with the amount, the account it came into and the invoice', seen[0] && seen[0].type === 'write_off_recovery' && seen[0].amount === 99 && seen[0].into === 'bank' && seen[0].invoice && seen[0].invoice.tax_minor === 900, JSON.stringify(seen[0]));
  ok('wiring: the entry is stamped wr:<client_ref> so the same ref is one entry', !!seen[0] && seen[0].source_ref === 'wr:wr-full');
  if (engineKnows) {
    ok('recover 99.00 → 200, posted', full.status === 200 && full.body.ok === true, full.status + ' ' + JSON.stringify(full.body));
    ok('recover 99.00 → Dr bank 99.00 · Cr bad debts 90.00 · Cr GST 9.00', JSON.stringify(movement(full)) === JSON.stringify([-9000, -900, 9900]), JSON.stringify(movement(full)));
    const part = await q({ amount_minor: 4950, reason: 'part paid', into: 'bank', against_ref: INV, client_ref: 'wr-part', date: '2026-11-21' });
    ok('part 49.50 → Dr bank 49.50 · Cr bad debts 45.00 · Cr GST 4.50 (the same share of the invoice)', part.status === 200 && JSON.stringify(movement(part)) === JSON.stringify([-4500, -450, 4950]), part.status + ' ' + JSON.stringify(movement(part)));
    const before = X.T.entries.length;
    const replay = await q({ amount_minor: 9900, reason: 'paid at last', into: 'bank', against_ref: INV, client_ref: 'wr-full', date: '2026-11-20' });
    ok('the same ref and body again → 200 duplicate, no second entry', replay.status === 200 && replay.body.duplicate === true && X.T.entries.length === before, replay.status + ' ' + JSON.stringify(replay.body));
    const other = await q({ amount_minor: 5000, reason: 'paid at last', into: 'bank', against_ref: INV, client_ref: 'wr-full', date: '2026-11-20' });
    ok('the same ref with another amount → 409 EVENT_REF_REUSED, nothing changed', other.status === 409 && other.body.code === 'EVENT_REF_REUSED' && X.T.entries.length === before, other.status + ' ' + JSON.stringify(other.body));
    const noInvoice = await q({ amount_minor: 1000, reason: 'paid', into: 'bank', client_ref: 'wr-none', date: '2026-11-22' });
    ok('no invoice named → the whole amount to bad debts', noInvoice.status === 200 && JSON.stringify(movement(noInvoice)) === JSON.stringify([-1000, 1000]), noInvoice.status + ' ' + JSON.stringify(noInvoice.body));
  } else { waiting += 7; console.log('   WAIT the engine here has no posting write_off_recovery (engines #165 not adopted): the 7 figure checks (99.00 → 90.00 + 9.00; 49.50 → 45.00 + 4.50; replay; reused ref; no invoice) did not run'); }
  const none = await q({ reason: 'paid' });
  ok('no amount → a 4xx in words', none.status === 400 || none.status === 422, none.status + ' ' + JSON.stringify(none.body));
  const neg = await q({ amount_minor: -5, reason: 'paid' });
  ok('a negative amount → a 4xx in words', neg.status === 400 || neg.status === 422, neg.status + ' ' + JSON.stringify(neg.body));
  who = { identity_id: '44444444-4444-4444-8444-444444444444', parent_entity_id: SHOP, identity_type: 'actor', access_level: 'editor' };
  const staff = await q({ amount_minor: 100, reason: 'paid' });
  ok('a seat that is not the owner → 403 (the write-off door guard)', staff.status === 403, staff.status + ' ' + JSON.stringify(staff.body));
  const text = fs.readFileSync(path.join(H.API, 'routes', 'books-write-off-recover.js'), 'utf8'), at = text.indexOf("router.post('/write-off/recover'"), body = text.slice(at, text.indexOf('module.exports', at));
  ok('the route holds no GST arithmetic (no tax_minor, no rate, no divide by 11)', at > 0 && !/tax_minor|\brate\b|\/ ?11\b|\* ?0\.1/.test(body.replace(/\/\*[\s\S]*?\*\//g, '')));
  bad.adjusted = realAdjusted; X.B.postEntry = realPost; srv.close();
  console.log('\n' + (fail ? '  FAILED ' + fail : '  ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks' + (waiting ? ' · ' + waiting + ' waiting for engines #165' : '') + '\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('   FAIL ' + (e && e.stack || e)); process.exit(1); });
