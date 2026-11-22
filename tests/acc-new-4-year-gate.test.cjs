/**
 * tests/acc-new-4-year-gate.test.cjs — API-new-1 and CTY-new-1 (l16-accfix, e2e money test 16 Nov): THE YEAR-CLOSE REFUSAL CARRIES THE PERIOD CODES, AND AE'S GATE FIRES WITHOUT A STAGGER.
 * Through real Express over the in-memory ledger (no database).
 *   · AU: the refusal return_open names the four BAS periods by label AND by code (period_codes: 2026-Q1 .. 2027-Q4; Jul-Sep 2026 is 2026-Q1), in the same order, and the first code is
 *     accepted by POST /gst/close as it stands (carried: the code the refusal asked for is the code the door takes); the labels still read in `periods` and in the `why`.
 *   · AE: no FTA stagger is stored, so there is no period table: the gate asks the stagger-free question (is every month of the year covered by a closed tax period?). Before: the status
 *     had no return_open and the year closed with no VAT201 closed. Now: twelve open months named, no codes (said), the close is 422 PERIOD_RETURN_OPEN with nothing written; each close
 *     shrinks the list; with every month closed the year closes (200). A shop that charges no tax (no TRN) has no gate.
 * Needs the books engines (BOOKS_ENGINES_SRC or the sibling ../chitbridge-engines/src). Run: node tests/acc-new-4-year-gate.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));

const AU = 'aaaaaaaa-6666-4111-8111-111111111111', AE = 'eeeeeeee-6666-4111-8111-111111111111', AENOTRN = 'eeeeeeee-7777-4111-8111-111111111111';
const owner = (id, name) => ({ identity_id: id, identity_type: 'entity', display_name: name });
let WHO = owner(AU, 'Bondi Grocer');
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
  console.log('\n== the year close: period codes in the refusal (AU) and the gate without a stagger (AE) ==\n');
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  X.T.identities.push({ identity_id: AU, gstn: '51824753556', display_name: 'Bondi Grocer', country: 'AU', policy_flags: { gst_registration: 'regular' } },
    { identity_id: AE, gstn: '100123456700003', display_name: 'Deira Stores', country: 'AE', policy_flags: { gst_registration: 'regular' } },
    { identity_id: AENOTRN, gstn: null, display_name: 'Karama Stall', country: 'AE', policy_flags: {} });
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/books' + p, b);
  let DAY = '2026-07-20'; const realDay = K.dayOf;
  K.dayOf = (ts, c) => (ts instanceof Date && Math.abs(ts.getTime() - Date.now()) < 5000 ? DAY : realDay(ts, c));
  const returnOpen = (body) => (body.refusals || []).find((r) => r.name === 'return_open');

  /* -- AU: the codes -- */
  const FY = '2026-27', CODES = ['2026-Q1', '2026-Q2', '2027-Q3', '2027-Q4'];
  await X.store.saveSetting(X.db, AU, { enabled: false, country: 'AU' });
  ok('AU: the ledger is on', (await q('POST', '/enable', {})).body.ok === true);
  DAY = '2027-07-10';
  const s0 = await q('GET', '/year/' + FY + '/status'), ro = returnOpen(s0.body);
  ok('AU status: return_open carries the four labels', ro && ro.periods.length === 4 && /Q1/.test(ro.periods[0]), JSON.stringify(ro));
  eq('AU: and the four codes the close takes, in the same order (Jul-Sep 2026 is 2026-Q1)', ro && ro.period_codes, CODES);
  ok('AU: the sentence shows each label with its code', ro && CODES.every((code) => ro.why.indexOf('[' + code + ']') >= 0) && /Close each BAS period first/.test(ro.why), ro && ro.why);
  const c0 = await q('POST', '/year/' + FY + '/close', {});
  ok('AU close: 422 PERIOD_RETURN_OPEN with period_codes beside it', c0.status === 422 && c0.body.code === 'PERIOD_RETURN_OPEN' && returnOpen(c0.body) && returnOpen(c0.body).period_codes.length === 4, JSON.stringify(c0.body));
  const q1 = await q('POST', '/gst/close', { period: ro.period_codes[0], client_ref: 'q1' });
  ok('AU: the first code of the refusal is the code POST /gst/close takes (200)', q1.status === 200 && q1.body.ok === true, JSON.stringify(q1.body));
  const s1 = await q('GET', '/year/' + FY + '/status');
  eq('AU: after it, the labels and the codes shrink together (3 labels, codes without 2026-Q1)', [returnOpen(s1.body).periods.length, returnOpen(s1.body).period_codes], [3, CODES.slice(1)]);

  /* -- AE: no stagger stored -- */
  const AEFY = '2026';
  DAY = '2026-01-05';
  WHO = owner(AE, 'Deira Stores');
  await X.store.saveSetting(X.db, AE, { enabled: false, country: 'AE' });
  ok('AE: the ledger is on', (await q('POST', '/enable', {})).body.ok === true);
  DAY = '2027-01-10';
  const a0 = await q('GET', '/year/' + AEFY + '/status'), ra = returnOpen(a0.body);
  ok('AE status: return_open FIRES with no stagger stored, naming the twelve open months', a0.status === 200 && ra && ra.periods.length === 12 && ra.periods[0] === 'Jan 2026' && ra.periods[11] === 'Dec 2026' && a0.body.can_close === false, JSON.stringify(a0.body.refusals));
  ok('AE: no codes (the code names the FTA stagger, which the shop gives when it closes) and the sentence says so', ra && ra.period_codes.length === 0 && /Close each VAT return period first/.test(ra.why) && /give it in Country setup first/.test(ra.why), ra && ra.why);
  const ac = await q('POST', '/year/' + AEFY + '/close', {});
  ok('AE close: 422 PERIOD_RETURN_OPEN, nothing hard-locked', ac.status === 422 && ac.body.code === 'PERIOD_RETURN_OPEN' && X.T.periods.filter((p) => p.entity_id === AE).every((p) => p.status !== 'hard_locked'), JSON.stringify(ac.body));
  const m1 = await q('POST', '/gst/close', { period: '2026-01', stagger: 'monthly', client_ref: 'ae-01' });
  ok('AE: closing January (monthly stagger) answers 200', m1.status === 200 && m1.body.ok === true, JSON.stringify(m1.body));
  const a1 = await q('GET', '/year/' + AEFY + '/status');
  ok('AE: eleven months left, January gone from the list', returnOpen(a1.body) && returnOpen(a1.body).periods.length === 11 && returnOpen(a1.body).periods[0] === 'Feb 2026', JSON.stringify(a1.body.refusals));
  for (let month = 2; month <= 12; month++) {
    const code = '2026-' + String(month).padStart(2, '0');
    const r = await q('POST', '/gst/close', { period: code, stagger: 'monthly', client_ref: 'ae-' + code });
    if (r.status !== 200) ok(code + ' closes', false, JSON.stringify(r.body));
  }
  const a2 = await q('GET', '/year/' + AEFY + '/status');
  ok('AE: every month covered, so no return_open and can_close is true', !returnOpen(a2.body) && a2.body.can_close === true, JSON.stringify(a2.body));
  const ac2 = await q('POST', '/year/' + AEFY + '/close', {});
  ok('AE CLOSE answers 200', ac2.status === 200 && ac2.body.ok === true, JSON.stringify(ac2.body));

  /* -- AE with no TRN: no gate -- */
  WHO = owner(AENOTRN, 'Karama Stall');
  DAY = '2026-01-05';
  await X.store.saveSetting(X.db, AENOTRN, { enabled: false, country: 'AE' });
  ok('AE no TRN: the ledger is on', (await q('POST', '/enable', {})).body.ok === true);
  DAY = '2027-01-10';
  const a3 = await q('GET', '/year/' + AEFY + '/status');
  ok('AE no TRN: no return_open (it files no VAT201)', !returnOpen(a3.body), JSON.stringify(a3.body.refusals));
  srv.close();
  console.log('\n' + (fail ? '  FAILED ' + fail : '  passed ' + pass) + ' of ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
