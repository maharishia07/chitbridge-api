/**
 * books-pages.test.cjs — PERF1: the Day book and a Ledger answer in PAGES (DISCIPLINES §2), and the pages add up to the whole.
 *
 * Proves, through real Express on the in-memory store (no database): ?limit is capped by the server (lib/page-limit) · the keyset
 * `next` walks every entry exactly once, in (date, entry no) order · a ledger page's running balance starts from the range's opening +
 * the lines before the cursor, so page 2's first balance follows page 1's last · the range's closing and Σ Dr / Σ Cr are the server's,
 * the same on every page and equal to the unpaged answer · ?entries= reads exactly those entries · no page asked = the whole range, as before.
 * Run: node tests/books-pages.test.cjs
 */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const H = require('./support/books-harness.cjs');

let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + why : '')); } };

const SHOP = '11111111-1111-4111-8111-111111111111', CUST = '22222222-2222-4222-8222-222222222222';
const OWNER = { identity_id: SHOP, identity_type: 'entity', display_name: 'Mayur Bhavan' };
const authStub = Object.assign((req, res, next) => { req.identity = OWNER; next(); }, {
  entityOf: (req) => req.identity.parent_entity_id || req.identity.identity_id,
  requireScope: () => (req, res, next) => next(),
});
const call = (port, p) => new Promise((done) => {
  http.get({ host: '127.0.0.1', port, path: p }, (res) => { let raw = ''; res.on('data', (c) => raw += c); res.on('end', () => { let j = {}; try { j = JSON.parse(raw || '{}'); } catch (_) {} done({ status: res.statusCode, body: j }); }); });
});

(async () => {
  console.log('\n══ PERF1 · the books in pages ══\n');
  const L = require(path.join(H.API, 'lib', 'page-limit'));
  ok('page-limit: absent → the default · above the max → the max · not a number → the default · 0 → 1', L.limitOf(undefined, 20, 200) === 20 && L.limitOf('1000000', 20, 200) === 200
    && L.limitOf('abc', 20, 200) === 20 && L.limitOf('0', 20, 200) === 1);
  ok('page-limit: a page is a whole number ≥ 1', L.pageOf('-3') === 1 && L.pageOf('7') === 7 && L.pageOf(undefined) === 1);

  const X = H.load({ auth: authStub });
  if (!X.src.dir) { console.log('\n   SKIP the books half: ' + X.src.why); console.log('\n  ✓ ' + pass + ' passed'); return process.exit(fail ? 1 : 0); }
  require.cache[require.resolve(path.join(H.API, 'lib', 'storage-object'))] = { exports: { available: async () => false } };
  const app = express(); app.use(express.json()); app.use('/api/books', require(path.join(H.API, 'routes', 'books')));
  const srv = app.listen(0); const port = srv.address().port;
  const q = (p) => call(port, '/api/books' + p);

  await X.B.enable(X.db, SHOP, {});
  X.T.parties.push({ owner: SHOP, party_id: CUST, party_no: 'P-00001', name: 'Ravi Stores', customer: true, credit_days: 10 });
  /* 23 bills over September — cash and credit — so a page of 5 needs five pages */
  for (let i = 0; i < 23; i++) {
    const d = '2026-09-' + String(1 + Math.floor(i / 2)).padStart(2, '0'), credit = i % 3 === 0;
    const r = await X.B.postEntry(X.db, SHOP, Object.assign({ type: 'sale_bill', date: d, currency: 'INR', source_ref: 'pg:' + i, by_rate: [{ rate: 5, taxable: 200 + 20 * i, cgst: 5 + i / 2, sgst: 5 + i / 2, igst: 0 }], round_off: 0 },   /* every head to the paisa */
      credit ? { party: CUST, paid: {} } : { paid: { cash: 210 + 21 * i } }));
    if (!r.ok) { ok('posting bill ' + i, false, JSON.stringify(r)); break; }
  }
  const R = '?from=2026-09-01&to=2026-09-30';

  /* ── the Day book ── */
  const whole = await q('/daybook' + R);
  ok('no page asked → the whole range, as before (23 entries, no total/next)', whole.status === 200 && whole.body.entries.length === 23 && whole.body.total === undefined && whole.body.next === undefined, JSON.stringify(Object.keys(whole.body)));
  const seen = []; let after = null, pages = 0, first = null;
  do {
    const r = await q('/daybook' + R + '&limit=5' + (after ? '&after=' + encodeURIComponent(after) : '') + '&page=' + (pages + 1));
    if (r.status !== 200) { ok('a Day book page answers', false, r.status + ' ' + JSON.stringify(r.body)); break; }
    if (!first) first = r.body;
    r.body.entries.forEach((e) => seen.push(e.entry_no));
    after = r.body.next; pages++;
  } while (after && pages < 10);
  ok('Day book pages of 5: 5 pages, every entry once, in the unpaged order', pages === 5 && seen.join() === whole.body.entries.map((e) => e.entry_no).join(), pages + ' · ' + seen.length);
  ok('…each page says total · page · limit (top-level) and the range\'s Σ from the server', first.total === 23 && first.page === 1 && first.limit === 5 && first.totals && first.totals.dr_minor === first.totals.cr_minor && first.totals.dr_minor > 0, JSON.stringify({ t: first.total, p: first.page, l: first.limit, s: first.totals }));
  const big = await q('/daybook' + R + '&limit=100000');
  ok('?limit above the server\'s maximum is the maximum (500), never the client\'s word', big.body.limit === 500, String(big.body.limit));
  const two = whole.body.entries.slice(3, 5).map((e) => e.entry_id);
  const ent = await q('/daybook' + R + '&entries=' + two.join(','));
  ok('?entries= → exactly those entries (a ledger line opens its own journal, not the year\'s)', ent.status === 200 && ent.body.entries.map((e) => e.entry_id).join() === two.join(), JSON.stringify(ent.body.entries && ent.body.entries.map((e) => e.entry_no)));

  /* ── a ledger (cash), in pages: the running balance carries across pages from the server's SUM ── */
  const lw = await q('/ledger/cash' + R);
  const rows = []; let la = null, lp = 0, lfirst = null;
  do {
    const r = await q('/ledger/cash' + R + '&limit=4' + (la ? '&after=' + encodeURIComponent(la) : ''));
    if (r.status !== 200) { ok('a ledger page answers', false, r.status + ' ' + JSON.stringify(r.body)); break; }
    if (!lfirst) lfirst = r.body;
    if (r.body.closing_minor !== lw.body.closing_minor || r.body.opening_minor !== lw.body.opening_minor) { ok('every page says the range\'s opening and closing', false, JSON.stringify([r.body.opening_minor, r.body.closing_minor])); break; }
    r.body.lines.forEach((l) => rows.push(l)); la = r.body.next; lp++;
  } while (la && lp < 20);
  ok('Ledger pages: the same lines and the SAME running balances as the unpaged ledger (page 2 starts where page 1 ended)', rows.length === lw.body.lines.length && rows.every((l, i) => l.running_minor === lw.body.lines[i].running_minor && l.ref === lw.body.lines[i].ref),
    rows.map((l) => l.running_minor).join() + ' vs ' + lw.body.lines.map((l) => l.running_minor).join());
  ok('…the closing and Σ Dr come from the server (equal to the unpaged closing; a page never adds its rows up)', lfirst.closing_minor === lw.body.closing_minor && lfirst.totals.dr_minor - lfirst.totals.cr_minor === lw.body.closing_minor - lw.body.opening_minor
    && lfirst.total === lw.body.lines.length, JSON.stringify({ c: lfirst.closing_minor, t: lfirst.totals, n: lfirst.total }));
  ok('…every line names its entry (entry_id) — the journal it opens is read by ?entries=', lw.body.lines.every((l) => !!l.entry_id));

  srv.close();
  console.log('\n  ' + (fail ? '✗ ' + fail + ' failed · ' : '✓ ') + pass + ' passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
