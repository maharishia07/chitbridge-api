/**
 * books-recurring.test.cjs — RECURRING ENTRIES (b281, DRAFT) AND THE DAILY SWEEP, THROUGH REAL EXPRESS, with a stand-in auth, db, store and
 * template table (no database; b281 is a DRAFT Athi runs).
 *
 * Proves: every route answers 503 BOOKS_NOT_MIGRATED until the table exists, and the sweep skips quietly · owner-only (403) · a template that
 * cannot be built is refused in words, at creation · CRUD (stop = active false, nothing deleted) · a due template is PROPOSED, not posted · accepting it
 * posts ONE owner-made MJ entry and moves the day on · a re-run (the template put back, as after a crash) never posts twice (client_ref =
 * template + date) · an `auto` template is posted by the sweep, catching up month by month and keeping the 31st · a locked month is NAMED
 * and the template stays put · the sweep posts a due accrual reversal ONCE, on its day, and not before.
 * Run: node tests/books-recurring.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };
const eq = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + '  want ' + JSON.stringify(want));
const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222';
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

/** an in-memory template table with the real module's store functions (b281 stood in); `migrated` is the switch the 503 test flips */
function memoryTemplates() {
  const rows = []; let seq = 0; const m = { migrated: false, rows };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const gone = () => { const e = new Error('relation "recurring_entry" does not exist'); e.code = '42P01'; throw e; };
  m.store = {
    async exists() { return m.migrated; },
    async list(h, e) { if (!m.migrated) gone(); return clone(rows.filter((r) => r.entity === e)); },
    async get(h, e, id) { if (!m.migrated) gone(); const r = rows.find((x) => x.entity === e && x.recurring_id === id); return r ? clone(r) : null; },
    async insert(h, e, t) {
      if (!m.migrated) gone();
      const r = { entity: e, recurring_id: '66666666-6666-4666-8666-' + String(++seq).padStart(12, '0'), name: t.name, event: clone(t.event), frequency: t.frequency, next_on: t.next_on, anchor_day: t.anchor_day,
        end_on: t.end_on || null, auto: !!t.auto, active: t.active !== false, last_done_on: null, created_by: t.created_by || null };
      rows.push(r); return clone(r);
    },
    async update(h, e, id, p) { if (!m.migrated) gone(); const r = rows.find((x) => x.entity === e && x.recurring_id === id); if (!r) return null; Object.assign(r, clone(p)); return clone(r); },
  };
  return m;
}

(async () => {
  console.log('\n══ /api/books — recurring entries and the daily sweep ══\n');
  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('   SKIP: ' + X.src.why); return; }
  const K = require(path.join(H.API, 'lib', 'books-hooks'));
  const R = require(path.join(H.API, 'lib', 'books-recurring'));
  const BP = require(path.join(H.API, 'lib', 'books-period'));
  const mem = memoryTemplates(); R.use(mem.store);
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (m, p, b) => call(port, m, '/api/books' + p, b);
  let DAY = '2026-09-01'; const realDay = K.dayOf;
  K.dayOf = (ts, c) => (ts instanceof Date && Math.abs(ts.getTime() - Date.now()) < 5000 ? DAY : realDay(ts, c));

  await X.store.saveSetting(X.db, SHOP, { enabled: false });
  ok('the ledger is on', (await q('POST', '/enable', {})).body.ok === true);
  X.T.parties.push({ owner: SHOP, party_id: CUST, party_no: 'P-00001', name: 'Ravi Stores', customer: true, credit_days: 10 });
  await X.B.postEntry(X.db, SHOP, { type: 'sale_bill', date: '2026-08-05', currency: 'INR', party: CUST, source_ref: 'chit:a', by_rate: [{ rate: 18, taxable: 1000, cgst: 90, sgst: 90, igst: 0 }], paid: { cash: 1180 }, round_off: 0 });
  const S = await X.B.settingOf(X.db, SHOP);
  const rentEvent = { kind: 'expense', class: 'rent', amount: 5000, how: 'bank', narration: 'Shop rent' };
  const posted = (pre) => X.T.entries.filter((e) => String(e.source_ref || '').indexOf(pre) === 0);

  /* 1 · before b281 */
  const g0 = await q('GET', '/recurring');
  ok('BEFORE b281: GET /recurring → 503 BOOKS_NOT_MIGRATED', g0.status === 503 && g0.body.code === 'BOOKS_NOT_MIGRATED', JSON.stringify(g0.body));
  const p0 = await q('POST', '/recurring', { name: 'Shop rent', event: rentEvent, frequency: 'monthly', next_on: '2026-09-01' });
  ok('…POST /recurring → 503 too, and nothing is stored', p0.status === 503 && p0.body.code === 'BOOKS_NOT_MIGRATED' && mem.rows.length === 0, JSON.stringify(p0.body));
  const sw0 = await R.sweep(SHOP, S, DAY);
  ok('…the sweep skips quietly: nothing proposed, nothing posted, no problem', sw0.proposed === 0 && sw0.posted.length === 0 && sw0.problems.length === 0, JSON.stringify(sw0));
  mem.migrated = true;

  /* 2 · owner-only, and asked in words */
  WHO = STAFF;
  const ROUTES = [['GET', '/recurring'], ['POST', '/recurring'], ['PATCH', '/recurring/66666666-6666-4666-8666-000000000001'], ['DELETE', '/recurring/66666666-6666-4666-8666-000000000001'],
    ['POST', '/recurring/66666666-6666-4666-8666-000000000001/post'], ['POST', '/recurring/66666666-6666-4666-8666-000000000001/skip']];
  const leaks = []; for (const [m, p] of ROUTES) { const r = await q(m, p, {}); if (r.status !== 403) leaks.push(m + ' ' + p + ' → ' + r.status); }
  WHO = OWNER;
  ok('OWNER-ONLY: all six recurring routes refuse a co-assist (403)', leaks.length === 0, leaks.join(' · '));
  const bad = [
    [{ event: rentEvent, frequency: 'monthly', next_on: '2026-09-01' }, /call it/],
    [{ name: 'x', event: rentEvent, frequency: 'weekly', next_on: '2026-09-01' }, /monthly, quarterly or yearly/],
    [{ name: 'x', event: rentEvent, frequency: 'monthly', next_on: '2026-02-30' }, /YYYY-MM-DD/],
    [{ name: 'x', event: { kind: 'nonsense' }, frequency: 'monthly', next_on: '2026-09-01' }, /What happened/],
    [{ name: 'x', event: rentEvent, frequency: 'monthly', next_on: '2026-09-01', end_on: '2026-08-01' }, /stop before it starts/],
  ];
  const badOut = []; for (const [b, re] of bad) { const r = await q('POST', '/recurring', b); if (!(r.status === 400 && re.test(r.body.error || ''))) badOut.push(JSON.stringify([r.status, r.body.error])); }
  ok('a template that is incomplete or cannot be built is refused (400) in words, nothing stored', badOut.length === 0 && mem.rows.length === 0, badOut.join(' · '));

  /* 3 · CRUD */
  const c1 = await q('POST', '/recurring', { name: 'Shop rent', event: Object.assign({ date: '1999-01-01', client_ref: 'x' }, rentEvent), frequency: 'monthly', next_on: '2026-09-01' });
  ok('POST /recurring → the template (proposed by default; a date or client_ref typed into the event is dropped)', c1.status === 200 && c1.body.auto === false && c1.body.active === true && !('date' in c1.body.event) && !('client_ref' in c1.body.event), JSON.stringify(c1.body));
  const RENT = c1.body.recurring_id;
  const pa = await q('PATCH', '/recurring/' + RENT, { name: 'Shop rent (Anna Nagar)' });
  ok('PATCH is a merge: the name changes, the rest stays', pa.status === 200 && pa.body.name === 'Shop rent (Anna Nagar)' && pa.body.frequency === 'monthly' && pa.body.event.amount === 5000, JSON.stringify(pa.body));
  const ls = await q('GET', '/recurring');
  ok('GET /recurring lists it', ls.status === 200 && ls.body.recurring.length === 1 && ls.body.recurring[0].next_on === '2026-09-01');

  /* 4 · the sweep PROPOSES; the owner accepts */
  const s1 = await R.sweep(SHOP, S, DAY);
  ok('the sweep on the due day PROPOSES it (1) and posts nothing', s1.proposed === 1 && s1.posted.length === 0 && posted('ev:expense:rec:').length === 0, JSON.stringify(s1));
  const acc = await q('POST', '/recurring/' + RENT + '/post', {});
  const e1 = posted('ev:expense:rec:' + RENT + ':2026-09-01')[0];
  ok('ACCEPT posts ONE owner-made entry — MJ series, dated the due day, client_ref = template + date — and moves the template to 1 Oct',
    acc.body.posted && acc.body.posted.ok && e1 && /^MJ\//.test(e1.entry_no) && e1.posting_date === '2026-09-01' && acc.body.template.next_on === '2026-10-01' && acc.body.template.last_done_on === '2026-09-01', JSON.stringify(acc.body));
  const again = await q('POST', '/recurring/' + RENT + '/post', {});
  ok('…accepting again is refused: the next one is not due until 1 Oct', again.status === 422 && /not due until 2026-10-01/.test(again.body.error), JSON.stringify(again.body));
  /* the sweep died after posting but before it moved the template: put it back; the repeat answers the FIRST entry */
  mem.rows[0].next_on = '2026-09-01'; mem.rows[0].last_done_on = null;
  const rep = await q('POST', '/recurring/' + RENT + '/post', {});
  ok('A RE-RUN NEVER POSTS TWICE: the template put back to 1 Sep answers duplicate, still one entry, and moves on', rep.body.posted.duplicate === true && posted('ev:expense:rec:' + RENT + ':2026-09-01').length === 1 && rep.body.template.next_on === '2026-10-01', JSON.stringify(rep.body));
  const sk = await q('POST', '/recurring/' + RENT + '/skip', {});
  ok('skip lets one pass without posting', sk.status === 200 && sk.body.skipped === '2026-10-01' && sk.body.template.next_on === '2026-11-01' && posted('ev:expense:rec:' + RENT + ':2026-10-01').length === 0, JSON.stringify(sk.body));

  /* 5 · auto: posted by the sweep, catching up, keeping the 31st */
  DAY = '2026-10-02';
  const c2 = await q('POST', '/recurring', { name: 'Insurance', event: { kind: 'expense', class: 'insurance', amount: 1200, how: 'bank', narration: 'Insurance' }, frequency: 'monthly', next_on: '2026-08-31', auto: true });
  ok('an auto template is created', c2.status === 200 && c2.body.auto === true && c2.body.anchor_day === 31, JSON.stringify(c2.body));
  const INS = c2.body.recurring_id;
  const s2 = await R.sweep(SHOP, S, DAY);
  const insEntries = () => X.T.entries.filter((e) => String(e.source_ref || '').indexOf('ev:expense:rec:' + INS + ':') === 0);
  eq('the sweep posts every missed day, oldest first: 31 Aug, 30 Sep (the 31st clamps to the short month)', [s2.posted.map((x) => x.date), s2.posted.every((x) => /^MJ\//.test(x.entry_no))], [['2026-08-31', '2026-09-30'], true]);
  ok('…and the template waits at 31 Oct, the 31st again', mem.rows.find((r) => r.recurring_id === INS).next_on === '2026-10-31' && insEntries().length === 2);
  const s3 = await R.sweep(SHOP, S, DAY);
  ok('…a second sweep posts nothing', s3.posted.length === 0 && insEntries().length === 2, JSON.stringify(s3));
  mem.rows.find((r) => r.recurring_id === INS).next_on = '2026-08-31';
  const s4 = await R.sweep(SHOP, S, DAY);
  ok('…even with the template put back, the sweep answers the same two entries (duplicate) and posts none new', s4.posted.length === 2 && s4.posted.every((x) => x.duplicate) && insEntries().length === 2, JSON.stringify(s4));

  /* 6 · a locked month is named, never moved */
  const c3 = await q('POST', '/recurring', { name: 'Old auto', event: { kind: 'expense', class: 'rent', amount: 100, how: 'bank' }, frequency: 'monthly', next_on: '2026-05-15', auto: true });
  await q('POST', '/periods/2026-27/2/lock', { reason: 'May done' });
  const s5 = await R.sweep(SHOP, S, DAY);
  const pr = s5.problems.find((p) => p.name === 'Old auto');
  ok('an auto template dated in a locked month is NAMED as a problem and does not move', pr && /locked/i.test(pr.why) && pr.date === '2026-05-15' && mem.rows.find((r) => r.recurring_id === c3.body.recurring_id).next_on === '2026-05-15', JSON.stringify(s5.problems));
  const st = await q('DELETE', '/recurring/' + c3.body.recurring_id);
  ok('DELETE stops it (active: false) — the row stays', st.status === 200 && st.body.stopped === true && st.body.active === false && mem.rows.some((r) => r.recurring_id === c3.body.recurring_id));
  const s6 = await R.sweep(SHOP, S, DAY);
  ok('…a stopped template is not swept', !s6.problems.some((p) => p.name === 'Old auto'));

  /* 7 · the accrual reversal — once, on its day */
  DAY = '2026-09-30';
  const ac = await BP.accrue(SHOP, S, { ref: 'ELEC-9', kind: 'outstanding', class: 'electricity', amount: 1200, date: '2026-09-30' }, SHOP);
  ok('an accrual is posted at the month end (turns back 1 Oct)', ac.ok && ac.reverses_on === '2026-10-01', JSON.stringify(ac));
  const r0 = await R.sweep(SHOP, S, '2026-09-30');
  ok('the sweep on 30 Sep does NOT reverse it (not due)', r0.reversed.length === 0 && posted('accrual-rev:').length === 0, JSON.stringify(r0.reversed));
  DAY = '2026-10-02';
  const r1 = await R.sweep(SHOP, S, DAY);
  const rv = posted('accrual-rev:ELEC-9');
  ok('the sweep on 2 Oct posts the reversal, dated 1 Oct, by the system (JV)', r1.reversed.length === 1 && r1.reversed[0].ref === 'ELEC-9' && rv.length === 1 && rv[0].posting_date === '2026-10-01' && /^JV\//.test(rv[0].entry_no), JSON.stringify([r1.reversed, rv.map((e) => [e.entry_no, e.posting_date])]));
  const r2 = await R.sweep(SHOP, S, DAY);
  ok('…and a second sweep posts it ONCE only', r2.reversed.length === 0 && posted('accrual-rev:ELEC-9').length === 1, JSON.stringify(r2.reversed));

  srv.close();
  console.log('\n' + (fail ? '  ✗ ' + fail + ' failed' : '  ✓ ' + pass + ' passed') + ' · ' + (pass + fail) + ' checks\n');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
