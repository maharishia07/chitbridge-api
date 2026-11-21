#!/usr/bin/env node
// @type: unit
/**
 * tests/prac150-practice-page.test.cjs — PRAC150 (21 Nov): the firm practice list is right at 150 clients (the auditor brings ~150), offline.
 * The defect: the contract admits limit up to bounds.LIMIT_MAX (200) but GET /practice halved it to 100 in silence (limit=200 answered 100 rows, total 150).
 * HAND-COMPUTED  150 clients seeded as the demo firm: 65 books_in + 30 complete + 21 checked + 21 ready + 13 lodged = 150.
 *   limit=200 → 150 rows, has_more false · page 1 of limit 100 → 100 rows, has_more true · page 2 → 50 rows, has_more false · no page words → 150 rows.
 *   Every page carries the SAME band (counted over all 150, never over the rows of the page) and the same total.
 * OWNS      the offline checks of pageAsked / pageOf at 150 rows and of the contract's limit maximum.   CALLED BY scripts/guards.cjs.   CARD  04-network/ACC-176-AUDITOR-GRANT
 */
'use strict';
process.env.NODE_ENV = 'test';
const path = require('path');
const assert = require('assert');
const P = require(path.join(__dirname, '..', 'lib', 'books-practice.js'));
const bounds = require(path.join(__dirname, '..', 'lib', 'bounds.js'));
const contract = require(path.join(__dirname, '..', 'lib', 'books-grants-contract.js'));
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('  ok   ' + name); } catch (e) { fail++; console.log('  FAIL ' + name + '\n         ' + String((e && e.message) || e).slice(0, 300)); } };

const SEED = [['books_in', 65], ['complete', 30], ['checked', 21], ['ready', 21], ['lodged', 13]];
const row = (stage, i) => ({ name: 'Client ' + String(i).padStart(3, '0'), books_on: true, stage, grant: { can_see_costs: false, ends_in_days: null }, year_end: { fy: 2026, complete: stage !== 'books_in', checked: 0 }, bank: { state: 'none' }, queries: { open: 0, on_us: 0, on_client: 0 }, bas: { due_in_days: null }, months_unlocked: 1, to_check: 2, changed: { n: 1 }, checked: { n: 0, of: 2 }, health: { status: 'good', codes: [] } });
const ALL = []; for (const [stage, n] of SEED) for (let k = 0; k < n; k++) ALL.push(row(stage, ALL.length));
const tiles = (band) => Object.fromEntries(band.pipeline.map((s) => [s.key, s.n]));

console.log('\nPRAC150 · the practice list at 150 clients');
t('150 seeded rows: 65 + 30 + 21 + 21 + 13', () => assert.strictEqual(ALL.length, 150));
t('the page maximum IS the contract limit maximum (one number, bounds.LIMIT_MAX = 200), and the route schema carries the same', () => {
  assert.strictEqual(P.PAGE_MAX, bounds.LIMIT_MAX);
  assert.strictEqual(contract.ROUTES['GET /practice'].queryBounds.limit.maximum, P.PAGE_MAX);
  assert.ok(/at most 200 a page/.test(contract.ROUTES['GET /practice'].summary), 'the summary says the max it honours');
});
t('limit=200 is honoured: 150 rows, total 150, no more', () => {
  const a = P.pageAsked({ limit: '200' }), p = P.pageOf(ALL, a, {});
  assert.deepStrictEqual([a.limit, p.clients.length, p.paging.total, p.paging.has_more, p.paging.limit], [200, 150, 150, false, 200]);
});
t('a limit past the maximum is held to it (never 500 rows from one call)', () => assert.strictEqual(P.pageAsked({ limit: '100000' }).limit, 200));
t('pages of 100: 100 then 50, in the same order, no row lost or doubled', () => {
  const p1 = P.pageOf(ALL, P.pageAsked({ page: '1', limit: '100' }), {}), p2 = P.pageOf(ALL, P.pageAsked({ page: '2', limit: '100' }), {});
  assert.deepStrictEqual([p1.clients.length, p1.paging.has_more, p2.clients.length, p2.paging.has_more], [100, true, 50, false]);
  assert.deepStrictEqual(p1.clients.concat(p2.clients).map((c) => c.name), ALL.map((c) => c.name));
  assert.strictEqual(p1.paging.total, p2.paging.total);
});
t('no page words: every one of the 150 (the web reads it this way)', () => {
  const p = P.pageOf(ALL, P.pageAsked({}), {});
  assert.deepStrictEqual([p.clients.length, p.paging.total, p.paging.has_more], [150, 150, false]);
});
t('the band is over all 150 on every page: stage tiles 65 / 30 / 21 / 21 / 13 and they sum to the total', () => {
  for (const q of [{}, { limit: '200' }, { page: '1', limit: '100' }, { page: '2', limit: '100' }, { page: '1', limit: '10' }]) {
    const p = P.pageOf(ALL, P.pageAsked(q), {}), b = tiles(p.band);
    assert.deepStrictEqual([b.books_in, b.complete, b.checked, b.ready, b.lodged], [65, 30, 21, 21, 13], JSON.stringify(q));
    assert.strictEqual(b.books_in + b.complete + b.checked + b.ready + b.lodged, p.paging.total, JSON.stringify(q));
    assert.strictEqual(p.band.clients, 150);
  }
});
t('the On us today tiles count clients over all 150 (to_check n 150, entries 300), not the rows of a page', () => {
  const p = P.pageOf(ALL, P.pageAsked({ page: '2', limit: '100' }), {});
  const tile = p.band.bands.find((b) => b.key === 'on_us').tiles.find((x) => x.key === 'to_check');
  assert.deepStrictEqual([tile.n, tile.entries], [150, 300]);
});
console.log('\n' + (pass + fail) + ' checks (' + pass + ' passed, ' + fail + ' failed)');
process.exit(fail ? 1 : 0);
