/**
 * acc-240-lock-trail.test.cjs — ACC-240 (AU-AUDITOR-READINESS §A7): A MONTH LOCK CAN BE LIFTED, BUT NEVER SILENTLY.
 *
 *   setPeriod already writes every lock / unlock to the insert-only books_change_log (who, when, old → new + reason). GET /periods now reads it
 *   back beside the month as `lock_trail: [{ at, by, action: 'locked' | 'unlocked', from, to, reason }]`, oldest first, so an auditor sees
 *   lock → unlock → relock on the month itself. No new table, no migration. The same on an IN and an AU shop; a refused unlock (no reason)
 *   leaves no row; a month nobody touched has an empty trail; a non-owner (the auditor's read) sees it too.
 *   Runs through the real router over the in-memory twin (tests/support/books-harness.cjs). No database.
 * Run: node tests/acc-240-lock-trail.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const SHOPS = { IN: 'bbbbbbbb-1111-4111-8111-240240240240', AU: 'bbbbbbbb-2222-4111-8111-240240240240' };
const NAMES = { IN: 'Mayur Bhavan', AU: 'Bondi Grocer' };
const AUDITOR = { identity_id: 'bbbbbbbb-4444-4111-8111-240240240240', identity_type: 'actor' };
let WHO = null;
const authStub = Object.assign((req, res, next) => { req.identity = WHO; next(); }, {
  entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id,
  requireScope: () => (req, res, next) => next(),
});
const call = (port, method, p, body) => new Promise((done) => {
  const b = JSON.stringify(body || {});
  const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) } },
    (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) { j = { raw }; } done({ status: res.statusCode, body: j }); }); });
  r.end(b);
});

(async () => {
  console.log('\n══ ACC-240 · the lock / unlock / relock trail beside the month ══\n');
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why + '\n\n0 checks'); return; }
  X.T.identities.push({ identity_id: SHOPS.IN, gstn: '29ABCDE1234F1Z5', display_name: NAMES.IN, country: 'IN', policy_flags: { gst_registration: 'regular' } },
    { identity_id: SHOPS.AU, gstn: '51824753556', display_name: NAMES.AU, country: 'AU', policy_flags: { gst_registration: 'regular' } });
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/books' + p, b);
  const realDay = K.dayOf; K.dayOf = (ts, c) => (ts instanceof Date && Math.abs(ts.getTime() - Date.now()) < 5000 ? '2027-07-10' : realDay(ts, c));   /* "now" is after FY 2026-27 */
  const FY = '2026-27';

  for (const country of ['IN', 'AU']) {
    const shop = SHOPS[country];
    WHO = { identity_id: shop, identity_type: 'entity', display_name: NAMES[country] };
    console.log('\n   ── ' + country + ' ──');
    await X.store.saveSetting(X.db, shop, { enabled: false, country });
    ok(country + ': the ledger is on', (await q('POST', '/enable', {})).body.ok === true);
    const cur = country === 'IN' ? 'INR' : 'AUD';
    await X.B.postEntry(X.db, shop, { type: 'walkin_day', ref: 'D-' + country, date: '2026-07-10', currency: cur, modes: { cash: 1100 }, by_rate: [country === 'IN' ? { rate: 10, taxable: 1000, cgst: 50, sgst: 50 } : { rate: 10, taxable: 1000, gst: 100 }] });   /* a sale creates the year's months */
    const month = async (n) => (await q('GET', '/periods?fy=' + FY)).body.periods.find((p) => Number(p.period) === n);

    eq(country + ': a month nobody touched has an empty trail', (await month(1)).lock_trail, []);
    ok(country + ': lock July', (await q('POST', '/periods/' + FY + '/1/lock', { reason: 'July signed off' })).status === 200);
    const bad = await q('POST', '/periods/' + FY + '/1/unlock', { reason: '   ' });
    ok(country + ': an unlock without a reason is refused', bad.status >= 400, JSON.stringify(bad.body));
    eq(country + ': …and leaves no row (the trail is still the one lock)', (await month(1)).lock_trail.map((x) => x.action), ['locked']);
    ok(country + ': unlock July with a reason', (await q('POST', '/periods/' + FY + '/1/unlock', { reason: 'late supplier bill' })).status === 200);
    ok(country + ': relock July', (await q('POST', '/periods/' + FY + '/1/lock', { reason: 'bill posted, signed off again' })).status === 200);

    WHO = Object.assign({}, AUDITOR, { parent_entity_id: shop });   /* the auditor / staff read, not the owner */
    const jul = await month(1), aug = await month(2);
    eq(country + ': July trail reads lock → unlock → relock, in order', jul.lock_trail.map((x) => [x.action, x.from, x.to, x.reason]), [
      ['locked', 'open', 'soft_locked', 'July signed off'],
      ['unlocked', 'soft_locked', 'open', 'late supplier bill'],
      ['locked', 'open', 'soft_locked', 'bill posted, signed off again']]);
    ok(country + ': every row says who and when', jul.lock_trail.every((x) => x.by && x.at), JSON.stringify(jul.lock_trail));
    eq(country + ': …who is the owner who acted (the same name the change log holds)', jul.lock_trail.map((x) => x.by), X.T.changes.filter((c) => c.entity_id === shop && c.row_id === FY + '/1').map((c) => c.by));
    eq(country + ': August, never touched, has an empty trail (no bleed between months)', aug.lock_trail, []);
    eq(country + ': July is soft_locked now (the trail agrees with the state)', jul.status, 'soft_locked');
  }
  K.dayOf = realDay; srv.close();
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
