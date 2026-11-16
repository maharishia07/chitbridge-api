/**
 * books-lodged-later.test.cjs — LODGED-LATER (found on sit-grund, 16 Nov 2026): an owner who closed a year WITHOUT the declaration can say later that its returns were lodged outside ChitBridge.
 *   · POST /year/:fy/close {returns_lodged:true} on a closed year records the declaration (the closing call's own words on every month + a change-log row) · 200 {declared:true, returns_lodged:true}
 *   · nothing is posted, no month is reopened · the repeat writes nothing (duplicate:true) · without the flag a closed year answers duplicate:true, returns_lodged:false and stays so
 *   · GET /year/:fy/status and GET /returns (the practice's howClosed) read it as lodged · a co-assist is refused OWNER_ONLY · the auditor seat on this write is tests/l16-audbank.test.cjs (every books write)
 *   · an open year with the flag still takes the closing path, its 422 unchanged
 * Run: CB_ENGINES_DIR=../chitbridge-engines node tests/books-lodged-later.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const AU = 'aaaaaaaa-7777-4111-8111-111111111111';
let seat = null;
const authStub = Object.assign((req, res, next) => { req.identity = Object.assign({ identity_id: AU, identity_type: 'entity', display_name: 'Bondi Grocer' }, seat ? { parent_entity_id: AU } : {}); next(); }, {
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
  console.log('\n══ /api/books — the years before last close, oldest first (PAST-YEARS) ══\n');
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  X.T.identities.push({ identity_id: AU, gstn: '51824753556', display_name: 'Bondi Grocer', country: 'AU', policy_flags: { gst_registration: 'regular' } });
    const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/books' + p, b);
  const CLOCK = require(path.join(H.API, 'lib', 'shop-clock')); const setDay = (day) => CLOCK.set(day + 'T02:00:00Z'); setDay('2024-07-02');
  const sale = async (date, ref) => { const r = await X.B.postEntry(X.db, AU, { type: 'walkin_day', ref, date, currency: 'AUD', modes: { cash: 1100 }, by_rate: [{ rate: 10, taxable: 1000, gst: 100 }] }); if (!r || r.ok === false) console.log('   sale refused', date, JSON.stringify(r).slice(0, 200)); return r; };
  await X.store.saveSetting(X.db, AU, { enabled: false, country: 'AU' });
  ok('the ledger is on', (await q('POST', '/enable', {})).body.ok === true);
  X.T.setting.get(AU).enabled_at = '2024-07-02T02:00:00.000Z'; /* the memory store stamps its own counter; the real upsert takes the shop clock (books.enable at:) */
  /* one sale a year: 1,000.00 ex GST each */
  for (const [on, date] of [['2024-07-10', '2024-07-09'], ['2025-07-10', '2025-07-09'], ['2026-07-10', '2026-07-09']]) { setDay(on); await sale(date, 'S' + date); }
  setDay('2027-07-10');
  const lockYear = async (fy) => { for (let m = 1; m <= 12; m++) { const r = await q('POST', '/periods/' + fy + '/' + m + '/lock', { reason: 'checked' }); if (r.status !== 200) return Object.assign(r, { month: m }); } return { status: 200 }; };
  const open = (b) => (b.refusals || []).find((r) => r.name === 'return_open');
  const mine = () => X.T.periods.filter((p) => p.entity_id === AU && p.fiscal_year === '2024-25');
  /* 0 · close 2024-25 the only way an AU year can close here (with the declaration), then put the books back as a close WITHOUT it leaves them: reason on each month without the words */
  ok('2024-25 months lock', (await lockYear('2024-25')).status === 200);
  ok('closed with the declaration', (await q('POST', '/year/2024-25/close', { returns_lodged: true })).status === 200);
  mine().forEach((p) => { p.reason = 'Year close 2024-25'; });
  const howOf = async () => { const r = await q('GET', '/returns?period=2024-Q1'); return r.body.period && r.body.period.state; };
  ok('a year closed without the word reads year_closed in the practice read, status returns_lodged false', (await howOf()) === 'year_closed' && (await q('GET', '/year/2024-25/status')).body.returns_lodged === false);
  const plain = await q('POST', '/year/2024-25/close', {});
  ok('a plain repeat close: 200 duplicate, returns_lodged false, nothing written', plain.status === 200 && plain.body.duplicate === true && plain.body.returns_lodged === false && mine().every((p) => !/lodged/.test(p.reason)));
  /* 1 · a co-assist may not declare */
  const entries = X.T.entries.filter((e) => e.entity_id === AU).length, logs = (X.T.changes || X.T.change_log || []).length;
  seat = 'co';
  const no = await q('POST', '/year/2024-25/close', { returns_lodged: true });
  seat = null;
  ok('a co-assist is refused OWNER_ONLY, nothing recorded', no.status === 403 && no.body.code === 'OWNER_ONLY' && mine().every((p) => !/lodged/.test(p.reason)), JSON.stringify(no.body).slice(0, 200));
  /* 2 · the owner says it later */
  const d = await q('POST', '/year/2024-25/close', { returns_lodged: true });
  ok('the declaration on the closed year: 200 declared, returns_lodged, not a duplicate', d.status === 200 && d.body.ok === true && d.body.declared === true && d.body.returns_lodged === true && d.body.duplicate === false && d.body.next === '2025-26', JSON.stringify(d.body));
  ok('…every month of 2024-25 (and the brought-forward row) says the returns were lodged, still hard locked', mine().length >= 13 && mine().every((p) => p.status === 'hard_locked' && /returns lodged/.test(p.reason)));
  ok('…nothing was posted', X.T.entries.filter((e) => e.entity_id === AU).length === entries);
  const st = await q('GET', '/year/2024-25/status');
  ok('status: closed and returns_lodged true', st.body.closed === true && st.body.returns_lodged === true && st.body.can_close === false, JSON.stringify(st.body));
  ok('the practice read (howClosed via /returns) now says declared_lodged', (await howOf()) === 'declared_lodged');
  const P = require(path.join(H.API, 'lib', 'books-year-past'));
  ok('the one reader agrees: howClosed(month rows) = declared_lodged', P.howClosed(mine()) === 'declared_lodged');
  /* 3 · the repeat writes nothing */
  const stamp = JSON.stringify(mine().map((p) => [p.period, p.status, p.reason, p.locked_at]));
  const rep = await q('POST', '/year/2024-25/close', { returns_lodged: true });
  ok('the repeat: 200 duplicate true, declared false, returns_lodged true, rows unchanged', rep.status === 200 && rep.body.duplicate === true && rep.body.declared === false && rep.body.returns_lodged === true && JSON.stringify(mine().map((p) => [p.period, p.status, p.reason, p.locked_at])) === stamp, JSON.stringify(rep.body));
  const plain2 = await q('POST', '/year/2024-25/close', {});
  ok('a plain close afterwards does not withdraw it (withdrawing is backlog)', plain2.body.returns_lodged === true && (await howOf()) === 'declared_lodged');
  /* 4 · the carry and the next year are untouched; an open year keeps its path */
  const nx = await q('GET', '/year/2025-26/status');
  ok('2025-26 status: no previous_year_open after the late declaration', !nx.body.refusals.some((r) => r.name === 'previous_year_open'), JSON.stringify(nx.body.refusals));
  const open1 = await q('POST', '/year/2026-27/close', { returns_lodged: true });
  ok('an open year with the flag still takes the closing path (422, nothing declared)', open1.status === 422 && !X.T.periods.some((p) => p.fiscal_year === '2026-27' && /lodged/.test(p.reason || '')), JSON.stringify(open1.body).slice(0, 160));
  srv.close();
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
