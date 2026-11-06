'use strict';
/**
 * tests/live-trips-writer.test.cjs - the SAFE writer of live round-trip counts never lowers a line, never fires a placeholder on a 4xx, and leaves every other line byte-identical (SPD-39).
 * Run: node tests/live-trips-writer.test.cjs - no DB, no network.
 */
const assert = require('assert');
const w = require('../tools/live-trips-writer.cjs');
let pass = 0;
const t = (name, fn) => { fn(); pass += 1; console.log('  ok   ' + name); };
const budget = { _doc: 'x', routes: {
  'POST /a': { file: 'a.js', trips: 50, wire: null, fired: false, why: 'stub answered 404' },
  'POST /b': { file: 'b.js', trips: 9, wire: 3, fired: true, status: 200 },
  'GET /c': { file: 'c.js', trips: 50, wire: null, fired: false, registered_only: true } } };
const live = { _doc: 'l', at: '2026-11-06T00:00:00Z', source: 's', routes: { 'POST /b': 9, 'GET /z': 4 } };
const day = '2026-11-06';

t('a real 2xx fires a placeholder with its basis and keeps the other lines the same object', () => {
  const r = w.applyMeasured(budget, live, [{ route: 'POST /a', trips: 5, status: 201 }], day);
  assert.deepStrictEqual(r.budget.routes['POST /a'], { file: 'a.js', trips: 5, wire: null, fired: true, status: 201, basis: 'live from sit-in 2026-11-06' });
  assert.strictEqual(r.budget.routes['POST /b'], budget.routes['POST /b']);
  assert.strictEqual(r.budget.routes['GET /c'], budget.routes['GET /c']);
  assert.deepStrictEqual(w.problems({ budget, live }, r), []);
});
t('a 4xx or a missing trips count is never a measurement', () => {
  const r = w.applyMeasured(budget, live, [{ route: 'POST /a', trips: 5, status: 404 }, { route: 'GET /c', trips: null, status: 200 }], day);
  assert.strictEqual(r.changed.length, 0);
  assert.strictEqual(r.budget.routes['POST /a'].fired, false);
});
t('a lower count never lowers a fired line or a live line', () => {
  const r = w.applyMeasured(budget, live, [{ route: 'POST /b', trips: 2, status: 200 }], day);
  assert.strictEqual(r.budget.routes['POST /b'].trips, 9);
  assert.strictEqual(r.live.routes['POST /b'], 9);
  assert.deepStrictEqual(w.problems({ budget, live }, r), []);
});
t('a higher live count raises a fired line (the live shop is the cost)', () => {
  const r = w.applyMeasured(budget, live, [{ route: 'POST /b', trips: 12, status: 200 }], day);
  assert.strictEqual(r.budget.routes['POST /b'].trips, 12);
});
t('an empty run changes nothing and leaves the live file without a measured key', () => {
  const r = w.applyMeasured(budget, live, [], day);
  assert.deepStrictEqual(r.live, live);
});
t('problems() names a lowered, dropped or wrongly fired line', () => {
  const bad = { budget: { routes: { 'POST /a': { trips: 50, fired: true, status: 404 }, 'POST /b': { trips: 3, fired: true } } }, live: { routes: { 'POST /b': 1 } } };
  const found = w.problems({ budget, live }, bad);
  assert.ok(found.some((s) => /GET \/c/.test(s)) && found.some((s) => /lowered: POST \/b/.test(s)) && found.some((s) => /without a 2xx/.test(s)) && found.some((s) => /live line dropped/.test(s)));
});
console.log('\n  ' + pass + ' checks · 0 failed');
