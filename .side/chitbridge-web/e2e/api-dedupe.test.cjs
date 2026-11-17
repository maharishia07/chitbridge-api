/**
 * api-dedupe.test.cjs — two identical GETs in the air at once must be ONE request, and must not share objects.
 *
 * ── ⚠️⚠️ WHY ────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Measured with CB_TRIPS on, 2026-09-13: one cold boot of the Catalogue fetched `prodList {limit:500}` THREE
 * times — five hundred products, three journeys, same answer. Three screens each asked as they came up.
 *
 * ⚠️ THE THREE WAYS THIS GOES WRONG SILENTLY, all asserted below:
 *   1. it does not actually collapse → back to three journeys, and nothing looks broken
 *   2. it caches beyond the flight → every screen in the product quietly starts reading stale data
 *   3. joiners share one object → one screen's in-place edit appears in another, only when they load together
 *
 * Run: node e2e/api-dedupe.test.cjs
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app', 'core.js'), 'utf8');
const i = src.indexOf('var _apiInflight = {};');
const j = src.indexOf('async function apiOnce(');
if (i < 0 || j < 0) throw new Error('dedupe block not found in core.js');
/* api() looks its row up with epOf(), which sits earlier in core.js beside CB_PREFS_EP: lifted too, never stubbed, so the real lookup runs */
const ei = src.indexOf('var CB_PREFS_EP = {');
const ej = src.indexOf('var CBPrefs = (function');
if (ei < 0 || ej < ei) throw new Error('epOf block not found in core.js');

let calls = 0;
const sandbox = {
  console, structuredClone,
  EP: { prodList: { m: 'GET', p: '/api/products' }, prodSave: { m: 'POST', p: '/api/products' } },
  apiOnce: () => { calls++; return new Promise((r) => setTimeout(() => r({ products: [{ id: 'p1', name: 'x' }] }), 20)); },
};
vm.createContext(sandbox);
vm.runInContext(src.slice(ei, ej) + src.slice(i, j) + '\nthis.api = api;', sandbox);

let bad = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) bad++; };

(async () => {
  console.log('\n══ API · one read, not three ══\n');

  /* 1 · three concurrent identical GETs */
  const [a, b, c] = await Promise.all([
    sandbox.api('prodList', { query: { limit: 500 } }),
    sandbox.api('prodList', { query: { limit: 500 } }),
    sandbox.api('prodList', { query: { limit: 500 } }),
  ]);
  ok(calls === 1, 'three concurrent identical GETs made ' + calls + ' request(s), expected 1');
  ok(!!(a && b && c && a.products && b.products && c.products), 'every caller got the answer');

  /* 3 · and their own copy of it — checked BEFORE the staleness test, since that one calls again */
  b.products[0].name = 'edited by the second caller';
  ok(a.products[0].name === 'x', 'a joiner editing its copy does not reach the other callers');
  ok(a !== b && b !== c, 'each caller holds a distinct object');

  /* 2 · not a cache: once it has landed, the next asker asks again */
  const before = calls;
  await sandbox.api('prodList', { query: { limit: 500 } });
  ok(calls === before + 1, 'after it lands the next read goes to the server (not cached)');

  /* a different query is a different question */
  const n = calls;
  await Promise.all([
    sandbox.api('prodList', { query: { limit: 10 } }),
    sandbox.api('prodList', { query: { limit: 500 } }),
  ]);
  ok(calls === n + 2, 'two different queries stayed two requests');

  /* ⚠️ writes are never collapsed — two POSTs are two intentions */
  const w = calls;
  await Promise.all([sandbox.api('prodSave', { body: { a: 1 } }), sandbox.api('prodSave', { body: { a: 1 } })]);
  ok(calls === w + 2, 'two identical POSTs stayed two requests');

  /* a failure must not poison the key for the life of the tab */
  calls = 0;
  sandbox.apiOnce = () => { calls++; return Promise.reject(new Error('boom')); };
  vm.runInContext('apiOnce = this.apiOnce;', sandbox);
  await sandbox.api('prodList', { query: { limit: 7 } }).catch(() => {});
  await sandbox.api('prodList', { query: { limit: 7 } }).catch(() => {});
  ok(calls === 2, 'a failed read is retried, not remembered (' + calls + ')');

  console.log('');
  process.exitCode = bad ? 1 : 0;
})();
